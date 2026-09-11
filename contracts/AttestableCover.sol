// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Cover, CoverStatus, EvidencePolicy} from "./AttestableTypes.sol";
import {IAttestableCover} from "./interfaces/IAttestableCover.sol";
import {IChainInfo, ChainInfoLib} from "./interfaces/IChainInfo.sol";

/// @title AttestableCover
/// @notice Parametric coverage against blockchain infrastructure going quiet.
///
/// A buyer pays a premium for protection. An underwriter posts collateral and
/// takes the other side. At the end of the window the contract settles itself
/// from cryptographically verified evidence — no claim is filed, no assessor
/// votes, no administrator approves.
///
/// The infrastructure operator being covered (e.g. Chainlink) is NOT a party.
/// They agree to nothing, stake nothing and lose nothing. They are the subject
/// of the contract, the way weather is the subject of a rainfall derivative.
/// This contract does not enforce an SLA and has no standing to.
///
/// This contract trusts AttestableASC completely for evidence AUTHENTICITY and
/// concerns itself only with MONEY. It never inspects a proof.
contract AttestableCover is IAttestableCover, Ownable, ReentrancyGuard {
    IChainInfo public immutable CHAIN_INFO;

    /// @notice The only address permitted to report verified evidence.
    address public asc;

    uint256 public nextCoverId = 1;
    mapping(uint256 => Cover) private _covers;

    /// @notice Replay protection, scoped PER COVER — never globally.
    /// One Chainlink update is legitimately valid evidence for every cover
    /// written against that feed and window; those are independent contracts.
    /// Consuming a query globally would let the first cover starve all others.
    mapping(uint256 => mapping(bytes32 => bool)) public consumedEvidence;

    event CoverCreated(
        uint256 indexed coverId, address indexed underwriter, uint256 collateral, uint256 premium, uint32 toleranceSecs
    );
    /// @param retrospective true if the coverage window had ALREADY ENDED when
    /// this cover was purchased. The outcome is then already determined by
    /// history, so the premium is not a price for risk. Surfaced loudly rather
    /// than blocked, because demonstrating settlement against real past evidence
    /// is legitimate — silently permitting it would not be.
    event CoverPurchased(uint256 indexed coverId, address indexed buyer, uint256 premium, bool retrospective);
    event CoverCancelled(uint256 indexed coverId);
    event EvidenceRecorded(
        uint256 indexed coverId, bytes32 indexed queryId, uint64 updatedAt, uint64 gap, uint64 maxGap, int256 price
    );
    event CoverSettled(
        uint256 indexed coverId,
        CoverStatus indexed outcome,
        uint64 maxGap,
        uint32 toleranceSecs,
        uint256 toBuyer,
        uint256 toUnderwriter
    );
    event AscUpdated(address indexed asc);

    error NotAsc();
    error CoverNotFound(uint256 coverId);
    error WrongStatus(CoverStatus expected, CoverStatus actual);
    error ZeroCollateral();
    error ZeroPremium();
    error PremiumMismatch(uint256 expected, uint256 sent);
    error InvalidWindow();
    error ZeroTolerance();
    error NotUnderwriter();
    error EvidenceAlreadyUsed(bytes32 queryId);
    error EvidenceOutOfWindow(uint64 updatedAt, uint64 windowStart, uint64 windowEnd);
    error EvidenceOutOfOrder(uint64 updatedAt, uint64 lastTimestamp);
    error WindowNotAttested(uint64 required, uint64 attested);
    error WindowNotClosed(uint64 windowEnd, uint64 nowTs);
    error TransferFailed();

    modifier onlyAsc() {
        if (msg.sender != asc) revert NotAsc();
        _;
    }

    constructor() Ownable(msg.sender) {
        CHAIN_INFO = ChainInfoLib.getChainInfo();
    }

    function setAsc(address newAsc) external onlyOwner {
        if (newAsc == address(0)) revert NotAsc();
        asc = newAsc;
        emit AscUpdated(newAsc);
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    /// @notice Underwriter opens a cover, posting collateral and setting terms.
    /// The collateral is the maximum payout; the premium is what a buyer must
    /// pay to take the other side.
    function createCover(EvidencePolicy calldata policy, uint256 premium)
        external
        payable
        returns (uint256 coverId)
    {
        if (msg.value == 0) revert ZeroCollateral();
        if (premium == 0) revert ZeroPremium();
        if (policy.windowEnd <= policy.windowStart) revert InvalidWindow();
        if (policy.toleranceSecs == 0) revert ZeroTolerance();

        coverId = nextCoverId++;

        Cover storage c = _covers[coverId];
        c.underwriter = msg.sender;
        c.collateral = msg.value;
        c.premium = premium;
        c.policy = policy;
        c.status = CoverStatus.OPEN;

        emit CoverCreated(coverId, msg.sender, msg.value, premium, policy.toleranceSecs);
    }

    /// @notice Buyer takes the cover by paying exactly the stated premium.
    /// Terms are immutable from this point.
    function buyCover(uint256 coverId) external payable {
        Cover storage c = _requireCover(coverId);
        if (c.status != CoverStatus.OPEN) revert WrongStatus(CoverStatus.OPEN, c.status);
        if (msg.value != c.premium) revert PremiumMismatch(c.premium, msg.value);

        c.buyer = msg.sender;
        c.status = CoverStatus.ACTIVE;

        emit CoverPurchased(coverId, msg.sender, msg.value, block.timestamp >= c.policy.windowEnd);
    }

    /// @notice Underwriter reclaims collateral from a cover nobody bought.
    function cancelCover(uint256 coverId) external nonReentrant {
        Cover storage c = _requireCover(coverId);
        if (c.status != CoverStatus.OPEN) revert WrongStatus(CoverStatus.OPEN, c.status);
        if (msg.sender != c.underwriter) revert NotUnderwriter();

        c.status = CoverStatus.CANCELLED;
        uint256 amount = c.collateral;
        c.collateral = 0;

        emit CoverCancelled(coverId);
        _pay(c.underwriter, amount);
    }

    // ------------------------------------------------------------------
    // Evidence
    // ------------------------------------------------------------------

    /// @notice Record one verified update. Called only by AttestableASC, and only
    /// after every authenticity check has passed.
    ///
    /// Evidence MUST arrive in chronological order. That constraint is what lets
    /// the max-interval policy be evaluated in O(1): we keep only the previous
    /// timestamp and the largest gap so far.
    ///
    /// Consequence worth understanding: skipping evidence makes the apparent gap
    /// LARGER, pushing the cover toward CLAIMED. That is correct — missing
    /// evidence genuinely means nobody can prove there was no outage — and it is
    /// incentive-compatible, since the underwriter profits from HEALTHY and is
    /// therefore motivated to submit everything.
    function recordEvidence(uint256 coverId, bytes32 queryId, uint64 updatedAt, int256 price, uint256 roundId)
        external
        onlyAsc
    {
        Cover storage c = _requireCover(coverId);
        if (c.status != CoverStatus.ACTIVE) revert WrongStatus(CoverStatus.ACTIVE, c.status);

        if (consumedEvidence[coverId][queryId]) revert EvidenceAlreadyUsed(queryId);

        if (updatedAt < c.policy.windowStart || updatedAt > c.policy.windowEnd) {
            revert EvidenceOutOfWindow(updatedAt, c.policy.windowStart, c.policy.windowEnd);
        }

        // Strictly increasing: enforces ordering and rejects duplicates by time.
        if (c.lastTimestamp != 0 && updatedAt <= c.lastTimestamp) {
            revert EvidenceOutOfOrder(updatedAt, c.lastTimestamp);
        }

        // Gap from the previous update, or from the window's opening edge for the
        // first piece of evidence — silence before the first update still counts.
        uint64 previous = c.lastTimestamp == 0 ? c.policy.windowStart : c.lastTimestamp;
        uint64 gap = updatedAt - previous;

        consumedEvidence[coverId][queryId] = true;
        c.lastTimestamp = updatedAt;
        c.evidenceCount += 1;
        if (gap > c.maxGap) c.maxGap = gap;

        emit EvidenceRecorded(coverId, queryId, updatedAt, gap, c.maxGap, price);
        roundId; // retained in the ASC's event for the UI; unused in settlement
    }

    // ------------------------------------------------------------------
    // Settlement
    // ------------------------------------------------------------------

    /// @notice Settle a cover once its window has closed and Attestcoin's
    /// attestation frontier has passed the window. Permissionless: it can only
    /// pay out according to evidence already verified and recorded, so there is
    /// nothing to gain by calling it early or often.
    function settle(uint256 coverId) external nonReentrant {
        Cover storage c = _requireCover(coverId);
        if (c.status != CoverStatus.ACTIVE) revert WrongStatus(CoverStatus.ACTIVE, c.status);

        // SECURITY: the coverage window must actually have ended in wall-clock
        // time. The attestation gate below is NOT sufficient on its own.
        //
        // THE EXPLOIT THIS BLOCKS: windowEnd (a timestamp) and windowEndBlock (a
        // source-chain height) are independent fields. A cover created with a
        // far-future windowEnd but an already-attested windowEndBlock would pass
        // the attestation gate immediately. A buyer could then settle on day one,
        // when no evidence exists yet, so tailGap spans the entire window — an
        // instant, guaranteed CLAIMED payout of the full collateral.
        if (block.timestamp < c.policy.windowEnd) {
            revert WindowNotClosed(c.policy.windowEnd, uint64(block.timestamp));
        }

        // Attestation-frontier gate. Without this, a cover could be settled as
        // CLAIMED merely because proofs had not yet become generatable — turning
        // a slow attestor set into a payout. We never claim to have proven
        // absence; we require that evidence COULD have been supplied first.
        if (!CHAIN_INFO.is_height_attested(c.policy.chainKey, c.policy.windowEndBlock)) {
            IChainInfo.HeightHashResult memory latest =
                CHAIN_INFO.get_latest_attestation_height_and_hash(c.policy.chainKey);
            revert WindowNotAttested(c.policy.windowEndBlock, latest.height);
        }

        // Closing edge: silence between the final update and the window's end.
        // With no evidence at all, the whole window is one unbroken silence.
        uint64 previous = c.lastTimestamp == 0 ? c.policy.windowStart : c.lastTimestamp;
        uint64 tailGap = c.policy.windowEnd - previous;
        uint64 finalMaxGap = tailGap > c.maxGap ? tailGap : c.maxGap;

        bool healthy = finalMaxGap <= c.policy.toleranceSecs;

        uint256 collateral = c.collateral;
        uint256 premium = c.premium;
        c.collateral = 0;
        c.premium = 0;
        c.maxGap = finalMaxGap;
        c.status = healthy ? CoverStatus.HEALTHY : CoverStatus.CLAIMED;

        uint256 toBuyer;
        uint256 toUnderwriter;
        if (healthy) {
            // Nothing happened. The underwriter earns the premium and takes back
            // their collateral — the absence of failure is what pays them.
            toUnderwriter = collateral + premium;
        } else {
            // The covered event occurred. The buyer receives the collateral; the
            // underwriter keeps the premium they were paid for the risk.
            toBuyer = collateral;
            toUnderwriter = premium;
        }

        emit CoverSettled(coverId, c.status, finalMaxGap, c.policy.toleranceSecs, toBuyer, toUnderwriter);

        if (toBuyer > 0) _pay(c.buyer, toBuyer);
        if (toUnderwriter > 0) _pay(c.underwriter, toUnderwriter);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice True if this cover's window had already closed when it was bought,
    /// meaning the outcome was already fixed by history. Consumers should display
    /// this prominently — it is the difference between insurance and a settled bet.
    function isRetrospective(uint256 coverId) external view returns (bool) {
        Cover storage c = _covers[coverId];
        return c.buyer != address(0) && block.timestamp >= c.policy.windowEnd;
    }

    function getPolicy(uint256 coverId) external view returns (EvidencePolicy memory) {
        return _covers[coverId].policy;
    }

    function isActive(uint256 coverId) external view returns (bool) {
        return _covers[coverId].status == CoverStatus.ACTIVE;
    }

    function getCover(uint256 coverId) external view returns (Cover memory) {
        return _covers[coverId];
    }

    /// @notice The gap that would decide settlement if the window closed now.
    /// Lets the UI show a provisional outcome without guessing at the maths.
    function projectedMaxGap(uint256 coverId) external view returns (uint64) {
        Cover storage c = _covers[coverId];
        uint64 previous = c.lastTimestamp == 0 ? c.policy.windowStart : c.lastTimestamp;
        uint64 tailGap = c.policy.windowEnd - previous;
        return tailGap > c.maxGap ? tailGap : c.maxGap;
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function _requireCover(uint256 coverId) private view returns (Cover storage c) {
        c = _covers[coverId];
        if (c.underwriter == address(0)) revert CoverNotFound(coverId);
    }

    function _pay(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
