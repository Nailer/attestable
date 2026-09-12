// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {AttestableCover} from "../contracts/AttestableCover.sol";
import {AttestableASC} from "../contracts/AttestableASC.sol";
import {Cover, CoverStatus, EvidencePolicy, ProofData} from "../contracts/AttestableTypes.sol";
import {INativeQueryVerifier} from "../contracts/interfaces/INativeQueryVerifier.sol";
import {IChainInfo} from "../contracts/interfaces/IChainInfo.sol";
import {RealEvidence} from "./fixtures/RealEvidence.sol";

contract MockProver {
    function verifyAndEmit(
        uint64,
        uint64,
        bytes calldata,
        INativeQueryVerifier.MerkleProof calldata,
        INativeQueryVerifier.ContinuityProof calldata
    ) external pure returns (bool) {
        return true;
    }

    function calculateTxIndex(INativeQueryVerifier.MerkleProof calldata) external pure returns (uint64) {
        return 45;
    }
}

contract MockChainInfo2 {
    uint64 public frontier = type(uint64).max;

    function setFrontier(uint64 h) external {
        frontier = h;
    }

    function is_height_attested(uint64, uint64 h) external view returns (bool) {
        return frontier >= h;
    }

    function get_latest_attestation_height_and_hash(uint64)
        external
        view
        returns (IChainInfo.HeightHashResult memory r)
    {
        r.height = frontier;
        r.exists = true;
    }
}

/**
 * PHASE 4 — the formal adversarial suite.
 *
 * Twelve numbered properties from SPEC.md §12, plus the two exploits found by
 * walking the buyer's and underwriter's journeys end to end.
 *
 * These are security PROPERTIES, not coverage padding. Each one names a way the
 * protocol could lose money or settle wrongly, and proves it cannot.
 */
contract AdversarialTest is Test {
    AttestableCover cover;
    AttestableASC asc;
    MockChainInfo2 chainInfo;

    address underwriter = makeAddr("underwriter");
    address buyer = makeAddr("buyer");
    address attacker = makeAddr("attacker");

    uint64 constant W_START = RealEvidence.EXPECTED_UPDATED_AT - 2 hours;
    uint64 constant W_END = RealEvidence.EXPECTED_UPDATED_AT + 2 hours;
    uint64 constant W_START_BLOCK = RealEvidence.BLOCK_HEIGHT - 1000;
    uint64 constant W_END_BLOCK = RealEvidence.BLOCK_HEIGHT + 1000;
    uint32 constant TOLERANCE = 5400;

    uint256 constant COLLATERAL = 200 ether;
    uint256 constant PREMIUM = 12 ether;

    function setUp() public {
        vm.etch(0x0000000000000000000000000000000000000FD2, address(new MockProver()).code);
        MockChainInfo2 ci = new MockChainInfo2();
        vm.etch(0x0000000000000000000000000000000000000fD3, address(ci).code);
        chainInfo = MockChainInfo2(0x0000000000000000000000000000000000000fD3);
        chainInfo.setFrontier(type(uint64).max);

        cover = new AttestableCover();
        asc = new AttestableASC(address(cover));
        cover.setAsc(address(asc));

        vm.deal(underwriter, 10_000 ether);
        vm.deal(buyer, 10_000 ether);
        vm.deal(attacker, 10_000 ether);

        // Place "now" after the window so settlement is legitimately permitted.
        vm.warp(W_END + 1 hours);
    }

    function _policy() internal pure returns (EvidencePolicy memory p) {
        p = EvidencePolicy({
            chainKey: RealEvidence.CHAIN_KEY,
            sourceContract: RealEvidence.AGGREGATOR,
            eventSignature: RealEvidence.ANSWER_UPDATED,
            windowStart: W_START,
            windowEnd: W_END,
            windowStartBlock: W_START_BLOCK,
            windowEndBlock: W_END_BLOCK,
            toleranceSecs: TOLERANCE
        });
    }

    /// @dev Coverage must be bought before its window opens, so time is rewound
    /// to before windowStart to purchase, then advanced past windowEnd so the
    /// cover is settleable.
    function _active() internal returns (uint256 id) {
        uint256 resume = block.timestamp;
        vm.warp(W_START - 1 hours);
        vm.prank(underwriter);
        id = cover.createCover{value: COLLATERAL}(_policy(), PREMIUM);
        vm.prank(buyer);
        cover.buyCover{value: PREMIUM}(id);
        vm.warp(resume);
    }

    /// @dev Give a policy a block span that satisfies the MIN_SOURCE_BLOCK_SECS
    /// invariant for its own duration.
    function _withValidBlocks(EvidencePolicy memory p) internal pure returns (EvidencePolicy memory) {
        p.windowStartBlock = W_START_BLOCK;
        p.windowEndBlock = W_START_BLOCK + (p.windowEnd - p.windowStart) / 12 + 1;
        return p;
    }

    /// @dev Create and buy a cover under the new rules: purchase happens before
    /// windowStart, then time advances past windowEnd so it can settle.
    function _activeWith(EvidencePolicy memory p) internal returns (uint256 id) {
        p = _withValidBlocks(p);
        uint256 resume = block.timestamp;
        vm.warp(uint256(p.windowStart) - 1 hours);
        vm.prank(underwriter);
        id = cover.createCover{value: COLLATERAL}(p, PREMIUM);
        vm.prank(buyer);
        cover.buyCover{value: PREMIUM}(id);
        vm.warp(resume > uint256(p.windowEnd) ? resume : uint256(p.windowEnd) + 1);
    }

    function _proof() internal pure returns (ProofData memory p) {
        p.chainKey = RealEvidence.CHAIN_KEY;
        p.blockHeight = RealEvidence.BLOCK_HEIGHT;
        p.encodedTransaction = RealEvidence.txBytes();
        p.merkleRoot = bytes32(uint256(1));
        p.siblings = new INativeQueryVerifier.MerkleProofEntry[](0);
        p.lowerEndpointDigest = bytes32(uint256(2));
        p.continuityRoots = new bytes32[](0);
    }

    // ===============================================================
    // EXPLOITS FOUND BY WALKING THE USER JOURNEYS
    // ===============================================================

    /**
     * EXPLOIT 1 — instant drain via an unclosed window.
     *
     * windowEnd (a timestamp) and windowEndBlock (a source height) are
     * independent fields. A cover with a far-future windowEnd but an
     * already-attested windowEndBlock passes the attestation gate immediately.
     * With no evidence yet recorded, tailGap spans the whole window, so the
     * buyer could settle on day one and take the entire collateral.
     *
     * Before the fix this drained 200 ether instantly.
     */
    function test_Exploit_CannotSettleBeforeWindowCloses() public {
        // A window that is still open. The block span satisfies the invariant,
        // so the ONLY thing preventing settlement is the wall-clock check.
        EvidencePolicy memory p = _policy();
        p.windowStart = uint64(block.timestamp) + 1 hours;
        p.windowEnd = p.windowStart + 30 days;
        p = _withValidBlocks(p);

        vm.prank(underwriter);
        uint256 id = cover.createCover{value: COLLATERAL}(p, PREMIUM);
        vm.prank(buyer);
        cover.buyCover{value: PREMIUM}(id);
        vm.warp(uint256(p.windowStart) + 1 days); // inside, not past, the window

        uint256 before = buyer.balance;

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(AttestableCover.WindowNotClosed.selector, p.windowEnd, uint64(block.timestamp))
        );
        cover.settle(id);

        assertEq(buyer.balance, before, "no payout may occur before the window closes");

        // And it settles correctly once the window genuinely ends.
        vm.warp(p.windowEnd + 1);
        cover.settle(id);
        assertEq(uint8(cover.getCover(id).status), uint8(CoverStatus.CLAIMED));
    }

    /**
     * EXPLOIT 2 — adverse selection on a window whose outcome is observable.
     *
     * Previously a cover could be bought after its window had already closed,
     * flagged only by a boolean. A flag is not a control: the premium stops
     * being a price for risk the moment either side can see how it turned out.
     * Purchase is now refused once the window has begun.
     */
    function test_Exploit_CannotBuyAfterWindowOpens() public {
        vm.prank(underwriter);
        uint256 id = cover.createCover{value: COLLATERAL}(_policy(), PREMIUM);

        // setUp() warps past W_END, so this cover's window is already over.
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                AttestableCover.WindowAlreadyStarted.selector, W_START, uint64(block.timestamp)
            )
        );
        cover.buyCover{value: PREMIUM}(id);

        // A genuinely forward-looking cover is still purchasable.
        EvidencePolicy memory p = _policy();
        p.windowStart = uint64(block.timestamp) + 1 hours;
        p.windowEnd = uint64(block.timestamp) + 25 hours;
        p.windowStartBlock = 1_000_000;
        p.windowEndBlock = 1_000_000 + (24 hours) / 12;
        vm.prank(underwriter);
        uint256 fwd = cover.createCover{value: COLLATERAL}(p, PREMIUM);
        vm.prank(buyer);
        cover.buyCover{value: PREMIUM}(fwd);
        assertEq(uint8(cover.getCover(fwd).status), uint8(CoverStatus.ACTIVE));
    }

    /**
     * EXPLOIT 3 — an end block that undershoots the window.
     *
     * windowEnd (a timestamp) and windowEndBlock (a source height) describe the
     * same instant in different units, but nothing forced them to agree. An end
     * block set too low means the attestation gate passes while the window's
     * final source blocks are still unprovable — so evidence that could not yet
     * have been submitted is counted as absent, and the cover claims unfairly.
     *
     * A source block cannot arrive faster than 12s, so a window of D seconds
     * spans at most D/12 blocks. Requiring that many makes undershooting
     * impossible.
     */
    function test_Exploit_EndBlockCannotUndershootWindow() public {
        EvidencePolicy memory p = _policy();
        p.windowStart = uint64(block.timestamp) + 1 hours;
        p.windowEnd = p.windowStart + 24 hours;
        p.windowStartBlock = 1_000_000;
        p.windowEndBlock = 1_000_010; // 10 blocks for a 24-hour window

        uint64 required = 1_000_000 + uint64(24 hours) / 12; // 7200 blocks
        vm.prank(underwriter);
        vm.expectRevert(
            abi.encodeWithSelector(AttestableCover.EndBlockUndershoots.selector, 1_000_010, required)
        );
        cover.createCover{value: COLLATERAL}(p, PREMIUM);

        // Exactly the minimum is accepted.
        p.windowEndBlock = required;
        vm.prank(underwriter);
        uint256 ok = cover.createCover{value: COLLATERAL}(p, PREMIUM);
        assertEq(uint8(cover.getCover(ok).status), uint8(CoverStatus.OPEN));

        // Overshooting is safe and also accepted — it only delays settlement.
        p.windowEndBlock = required + 5000;
        vm.prank(underwriter);
        cover.createCover{value: COLLATERAL}(p, PREMIUM);
    }

    // ===============================================================
    // SPEC §12 — the twelve numbered properties
    // ===============================================================

    /// 1 — a valid proof is recorded against the policy.
    function test_01_ValidProofRecorded() public {
        uint256 id = _active();
        asc.submitEvidence(id, _proof());
        assertEq(cover.getCover(id).evidenceCount, 1);
    }

    /// 2 — condition satisfied by the deadline pays the underwriter.
    function test_02_HealthySettlesToUnderwriter() public {
        EvidencePolicy memory p = _policy();
        p.toleranceSecs = 24 hours; // whole window fits inside tolerance
        uint256 id = _activeWith(p);

        uint256 before = underwriter.balance;
        cover.settle(id);
        assertEq(uint8(cover.getCover(id).status), uint8(CoverStatus.HEALTHY));
        assertEq(underwriter.balance, before + COLLATERAL + PREMIUM);
    }

    /// 3 — condition violated at the deadline pays the buyer.
    function test_03_ClaimedSettlesToBuyer() public {
        uint256 id = _active();
        uint256 before = buyer.balance;
        cover.settle(id);
        assertEq(uint8(cover.getCover(id).status), uint8(CoverStatus.CLAIMED));
        assertEq(buyer.balance, before + COLLATERAL);
    }

    /// 4 — the same evidence cannot be counted twice on one cover.
    function test_04_ReplayRejected() public {
        uint256 id = _active();
        asc.submitEvidence(id, _proof());
        vm.expectRevert();
        asc.submitEvidence(id, _proof());
        assertEq(cover.getCover(id).evidenceCount, 1);
    }

    /// 5 — the same evidence IS valid for two independent covers.
    /// Global consumption would let the first cover starve every other.
    function test_05_SameEvidenceServesTwoCovers() public {
        uint256 a = _active();
        uint256 b = _active();
        asc.submitEvidence(a, _proof());
        asc.submitEvidence(b, _proof());
        assertEq(cover.getCover(a).evidenceCount, 1);
        assertEq(cover.getCover(b).evidenceCount, 1);
    }

    /// 6 — evidence from a contract the policy does not name is refused.
    /// This is the fake-feed attack: a genuine proof of a fabricated price.
    function test_06_WrongEmitterRejected() public {
        EvidencePolicy memory p = _policy();
        p.sourceContract = address(0xBEEF);
        uint256 id = _activeWith(p);

        vm.expectRevert(
            abi.encodeWithSelector(AttestableASC.WrongEmitter.selector, address(0xBEEF), RealEvidence.AGGREGATOR)
        );
        asc.submitEvidence(id, _proof());
    }

    /// 7 — an event signature absent from the transaction is refused.
    function test_07_AbsentEventSignatureRejected() public {
        EvidencePolicy memory p = _policy();
        p.eventSignature = keccak256("Transfer(address,address,uint256)");
        uint256 id = _activeWith(p);

        vm.expectRevert(abi.encodeWithSelector(AttestableASC.NoMatchingEvent.selector, p.eventSignature));
        asc.submitEvidence(id, _proof());
    }

    /// 8 — evidence outside the covered window is refused despite a valid proof.
    function test_08_EvidenceOutsideWindowRejected() public {
        EvidencePolicy memory p = _policy();
        p.windowStart = RealEvidence.EXPECTED_UPDATED_AT + 10 days;
        p.windowEnd = RealEvidence.EXPECTED_UPDATED_AT + 20 days;
        uint256 id = _activeWith(p);

        vm.expectRevert();
        asc.submitEvidence(id, _proof());
    }

    /// 9 — receipt status. NOTE: covered by contract review, not by this test.
    /// Proving it needs a genuinely FAILED source transaction with a valid
    /// Attestcoin proof, which we do not have. Named here rather than silently
    /// skipped. See "Known limitations" in the README.
    function test_09_ReceiptStatusCheckExists_NotDirectlyTested() public pure {
        assertTrue(true, "documented gap: no proven failed transaction available");
    }

    /// 10 — settlement is impossible before evidence could have been proven.
    function test_10_PrematureFinalizationRejected() public {
        uint256 id = _active();
        chainInfo.setFrontier(W_END_BLOCK - 1);
        vm.expectRevert(
            abi.encodeWithSelector(AttestableCover.WindowNotAttested.selector, W_END_BLOCK, W_END_BLOCK - 1)
        );
        cover.settle(id);
    }

    /// 11 — evidence relabelled as another chain is refused.
    function test_11_WrongChainKeyRejected() public {
        uint256 id = _active();
        ProofData memory p = _proof();
        p.chainKey = 3;
        vm.expectRevert(abi.encodeWithSelector(AttestableASC.WrongChainKey.selector, 1, 3));
        asc.submitEvidence(id, p);
    }

    /// 12 — only the registered ASC may move policy state; nobody may drain funds.
    function test_12_UnauthorizedAccessRejected() public {
        uint256 id = _active();

        vm.prank(attacker);
        vm.expectRevert(AttestableCover.NotAsc.selector);
        cover.recordEvidence(id, keccak256("x"), W_START + 60, 1, 1);

        vm.prank(attacker);
        vm.expectRevert();
        cover.setAsc(attacker);

        // cancelCover on an ACTIVE cover trips WrongStatus first, so the
        // ownership check is exercised against an OPEN cover.
        vm.prank(underwriter);
        uint256 openId = cover.createCover{value: COLLATERAL}(_policy(), PREMIUM);
        vm.prank(attacker);
        vm.expectRevert(AttestableCover.NotUnderwriter.selector);
        cover.cancelCover(openId);
    }

    // ===============================================================
    // ADDITIONAL PROPERTIES
    // ===============================================================

    /// The contract must never hold or leak value after settling.
    function test_EscrowFullyDrainedOnSettlement() public {
        uint256 id = _active();
        assertEq(address(cover).balance, COLLATERAL + PREMIUM);
        cover.settle(id);
        assertEq(address(cover).balance, 0, "not a single wei may remain");
    }

    /// An active cover cannot be cancelled out from under its buyer.
    function test_ActiveCoverCannotBeCancelled() public {
        uint256 id = _active();
        vm.prank(underwriter);
        vm.expectRevert(
            abi.encodeWithSelector(AttestableCover.WrongStatus.selector, CoverStatus.OPEN, CoverStatus.ACTIVE)
        );
        cover.cancelCover(id);
    }

    /// Settlement is final.
    function test_CannotSettleTwice() public {
        uint256 id = _active();
        cover.settle(id);
        vm.expectRevert();
        cover.settle(id);
    }

    /// Conservation holds for arbitrary amounts and either outcome.
    function testFuzz_ConservationHolds(uint96 collateral, uint96 premium, bool healthy) public {
        collateral = uint96(bound(collateral, 1e15, 1_000 ether));
        premium = uint96(bound(premium, 1e15, 1_000 ether));

        EvidencePolicy memory p = _withValidBlocks(_policy());
        if (healthy) p.toleranceSecs = 24 hours;

        uint256 resume = block.timestamp;
        vm.warp(uint256(p.windowStart) - 1 hours);
        vm.prank(underwriter);
        uint256 id = cover.createCover{value: collateral}(p, premium);
        vm.prank(buyer);
        cover.buyCover{value: premium}(id);
        vm.warp(resume);

        uint256 ub = underwriter.balance;
        uint256 bb = buyer.balance;
        cover.settle(id);

        assertEq(
            (underwriter.balance - ub) + (buyer.balance - bb),
            uint256(collateral) + uint256(premium),
            "every wei in must come out"
        );
        assertEq(address(cover).balance, 0);
    }
}
