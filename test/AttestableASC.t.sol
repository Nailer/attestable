// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {AttestableASC} from "../contracts/AttestableASC.sol";
import {AttestableCover} from "../contracts/AttestableCover.sol";
import {EvidencePolicy, ProofData, CoverStatus, Cover} from "../contracts/AttestableTypes.sol";
import {INativeQueryVerifier} from "../contracts/interfaces/INativeQueryVerifier.sol";
import {IChainInfo} from "../contracts/interfaces/IChainInfo.sol";
import {RealEvidence} from "./fixtures/RealEvidence.sol";

/// @dev Stands in for the Block Prover precompile, which has no bytecode on a
/// local EVM. Cryptographic verification itself was proven against the REAL
/// precompile on Creditcoin in spike 1.12/1.13 — five tampering and replay
/// attacks were rejected there. These tests cover everything the precompile
/// does NOT do: receipt status, emitter identity, and event shape.
contract MockBlockProver {
    bool public shouldVerify = true;
    uint64 public txIndex = 45;

    function setShouldVerify(bool v) external {
        shouldVerify = v;
    }

    function verifyAndEmit(
        uint64,
        uint64,
        bytes calldata,
        INativeQueryVerifier.MerkleProof calldata,
        INativeQueryVerifier.ContinuityProof calldata
    ) external view returns (bool) {
        return shouldVerify;
    }

    function calculateTxIndex(INativeQueryVerifier.MerkleProof calldata) external view returns (uint64) {
        return txIndex;
    }
}

contract MockChainInfoASC {
    function is_height_attested(uint64, uint64) external pure returns (bool) {
        return true;
    }

    function get_latest_attestation_height_and_hash(uint64)
        external
        pure
        returns (IChainInfo.HeightHashResult memory r)
    {
        r.exists = true;
    }
}

contract AttestableASCTest is Test {
    AttestableASC asc;
    AttestableCover cover;
    MockBlockProver prover;

    address underwriter = makeAddr("underwriter");
    address buyer = makeAddr("buyer");

    uint64 constant WINDOW_START = RealEvidence.EXPECTED_UPDATED_AT - 1 hours;
    uint64 constant WINDOW_END = RealEvidence.EXPECTED_UPDATED_AT + 12 hours;
    uint64 constant WINDOW_END_BLOCK = RealEvidence.BLOCK_HEIGHT + 5000;
    uint32 constant TOLERANCE = 5400;

    uint256 constant COLLATERAL = 200 ether;
    uint256 constant PREMIUM = 12 ether;

    function setUp() public {
        prover = new MockBlockProver();
        vm.etch(0x0000000000000000000000000000000000000FD2, address(prover).code);
        prover = MockBlockProver(0x0000000000000000000000000000000000000FD2);
        prover.setShouldVerify(true);

        MockChainInfoASC ci = new MockChainInfoASC();
        vm.etch(0x0000000000000000000000000000000000000fD3, address(ci).code);

        cover = new AttestableCover();
        asc = new AttestableASC(address(cover));
        cover.setAsc(address(asc));

        vm.deal(underwriter, 1000 ether);
        vm.deal(buyer, 1000 ether);
    }

    function _policy(address emitter, bytes32 sig, uint64 chainKey)
        internal
        pure
        returns (EvidencePolicy memory p)
    {
        p = EvidencePolicy({
            chainKey: chainKey,
            sourceContract: emitter,
            eventSignature: sig,
            windowStart: WINDOW_START,
            windowEnd: WINDOW_END,
            windowEndBlock: WINDOW_END_BLOCK,
            toleranceSecs: TOLERANCE
        });
    }

    function _defaultPolicy() internal pure returns (EvidencePolicy memory) {
        return _policy(RealEvidence.AGGREGATOR, RealEvidence.ANSWER_UPDATED, RealEvidence.CHAIN_KEY);
    }

    function _openCover(EvidencePolicy memory p) internal returns (uint256 id) {
        vm.prank(underwriter);
        id = cover.createCover{value: COLLATERAL}(p, PREMIUM);
        vm.prank(buyer);
        cover.buyCover{value: PREMIUM}(id);
    }

    function _proof() internal pure returns (ProofData memory p) {
        p.chainKey = RealEvidence.CHAIN_KEY;
        p.blockHeight = RealEvidence.BLOCK_HEIGHT;
        p.encodedTransaction = RealEvidence.txBytes();
        p.merkleRoot = 0xd9c5259c69e12174e99b6e9764e0397a540745b05b400a6b3ae7944bd7c0bc3d;
        p.siblings = new INativeQueryVerifier.MerkleProofEntry[](0);
        p.lowerEndpointDigest = 0x2cf600da72e0e27c2e09e128cd72e2ebe9233e4c643b3e8e4edc78c381cc681b;
        p.continuityRoots = new bytes32[](0);
    }

    // =================================================================
    // 2.1 — the ASC decodes REAL evidence correctly
    // =================================================================

    /// @notice The decoder must recover exactly the values we independently
    /// derived by hand in spike 1.8A and confirmed against the live feed.
    function test_Decode_RealEvidence_MatchesHandDecodedValues() public {
        uint256 id = _openCover(_defaultPolicy());

        vm.recordLogs();
        asc.submitEvidence(id, _proof());

        Cover memory c = cover.getCover(id);
        assertEq(c.evidenceCount, 1, "evidence must be recorded");
        assertEq(c.lastTimestamp, RealEvidence.EXPECTED_UPDATED_AT, "updatedAt must come from event data");
    }

    /// @notice The price and roundId surfaced for the UI must also be correct —
    /// reading the wrong topic slot would still produce a plausible-looking number.
    function test_Decode_EmitsCorrectPriceAndRound() public {
        uint256 id = _openCover(_defaultPolicy());

        vm.expectEmit(true, false, true, true, address(asc));
        emit AttestableASC.EvidenceVerified(
            id,
            bytes32(0), // queryId not asserted
            RealEvidence.BLOCK_HEIGHT,
            RealEvidence.AGGREGATOR,
            RealEvidence.EXPECTED_PRICE,
            RealEvidence.EXPECTED_ROUND_ID,
            RealEvidence.EXPECTED_UPDATED_AT
        );
        asc.submitEvidence(id, _proof());
    }

    // =================================================================
    // 2.1 — emitter and signature checks
    // =================================================================

    /// @notice THE ATTACK THIS BLOCKS: deploy a lookalike contract, emit an
    /// identically-shaped event with an invented price, obtain a completely
    /// honest proof of it. The proof is real; the evidence is worthless.
    /// Confirmed rejected against the live precompile in spike 1.13 (A5).
    function test_RejectsWrongEmitter() public {
        address impostor = address(0xBEEF);
        uint256 id = _openCover(_policy(impostor, RealEvidence.ANSWER_UPDATED, RealEvidence.CHAIN_KEY));

        vm.expectRevert(
            abi.encodeWithSelector(AttestableASC.WrongEmitter.selector, impostor, RealEvidence.AGGREGATOR)
        );
        asc.submitEvidence(id, _proof());
    }

    /// @notice A signature genuinely absent from the transaction must be refused.
    function test_RejectsAbsentEventSignature() public {
        bytes32 absentSig = keccak256("Transfer(address,address,uint256)");
        uint256 id = _openCover(_policy(RealEvidence.AGGREGATOR, absentSig, RealEvidence.CHAIN_KEY));

        vm.expectRevert(abi.encodeWithSelector(AttestableASC.NoMatchingEvent.selector, absentSig));
        asc.submitEvidence(id, _proof());
    }

    /// @notice DOCUMENTED BEHAVIOUR, discovered while writing these tests.
    ///
    /// A single Chainlink update emits THREE events in one transaction —
    /// AnswerUpdated, NewTransmission and NewRound (confirmed in spike 1.4: 27
    /// of each per 24h). NewRound has the SAME SHAPE as AnswerUpdated: three
    /// topics and one 32-byte data word. So a policy naming NewRound decodes
    /// successfully, reading NewRound's fields as though they were
    /// AnswerUpdated's.
    ///
    /// This is not a vulnerability — the contract faithfully executes the policy
    /// it was given, and the policy is immutable and publicly readable before
    /// anyone buys. But it means the shape assertion CANNOT catch a
    /// misconfigured signature, because two real events share a shape. The
    /// defence is policy review at purchase time, not a runtime check.
    ///
    /// Second observation, found by this test failing on its first assertion:
    /// NewRound.startedAt and AnswerUpdated.updatedAt are IDENTICAL, because
    /// both describe the same round. So for staleness specifically, naming the
    /// wrong event still yields the correct settlement timestamp. The price
    /// field would be garbage (roundId read as price), but price does not enter
    /// settlement — only the timestamp does. A lucky escape, not a design.
    /// @notice STEP 1 REGRESSION — evidence identity is now EVENT-level.
    ///
    /// This same transaction carries three events. Under the old
    /// transaction-level identity, evidence drawn from different logs of the
    /// same transaction produced an IDENTICAL id — so consuming one silently
    /// consumed the others. Two covers whose policies name different events in
    /// the same transaction must now receive distinct ids.
    function test_EvidenceIdIsEventLevel_NotTransactionLevel() public {
        uint256 a = _openCover(_defaultPolicy());
        bytes32 idAnswerUpdated = asc.submitEvidence(a, _proof());

        bytes32 newRound = keccak256("NewRound(uint256,address,uint256)");
        uint256 b = _openCover(_policy(RealEvidence.AGGREGATOR, newRound, RealEvidence.CHAIN_KEY));
        bytes32 idNewRound = asc.submitEvidence(b, _proof());

        assertTrue(
            idAnswerUpdated != idNewRound,
            "two different logs in ONE transaction must have different evidence ids"
        );
    }

    /// @notice Selection now matches signature AND emitter together.
    ///
    /// getLogsByEventSignature() matches on signature alone, so its first result
    /// could be a lookalike event from an impostor contract. Scanning for both
    /// at once means the impostor is never selected in the first place.
    function test_ImpostorEventInSameTransactionIsNotSelected() public {
        address impostor = address(0xBEEF);
        uint256 id = _openCover(_policy(impostor, RealEvidence.ANSWER_UPDATED, RealEvidence.CHAIN_KEY));

        // The real transaction contains AnswerUpdated from the REAL aggregator.
        // A policy naming an impostor must be told the emitter was wrong, not
        // handed the real aggregator's event by accident.
        vm.expectRevert(
            abi.encodeWithSelector(AttestableASC.WrongEmitter.selector, impostor, RealEvidence.AGGREGATOR)
        );
        asc.submitEvidence(id, _proof());
    }

    function test_PolicyNamingADifferentRealEvent_DecodesThatEventInstead() public {
        bytes32 newRound = keccak256("NewRound(uint256,address,uint256)");
        uint256 id = _openCover(_policy(RealEvidence.AGGREGATOR, newRound, RealEvidence.CHAIN_KEY));

        asc.submitEvidence(id, _proof());

        Cover memory c = cover.getCover(id);
        assertEq(c.evidenceCount, 1, "a real NewRound event exists in this same transaction");
        assertEq(
            c.lastTimestamp,
            RealEvidence.EXPECTED_UPDATED_AT,
            "NewRound.startedAt equals AnswerUpdated.updatedAt - same round, same instant"
        );
    }

    function test_RejectsWrongChainKey() public {
        uint256 id = _openCover(_policy(RealEvidence.AGGREGATOR, RealEvidence.ANSWER_UPDATED, 3));

        vm.expectRevert(abi.encodeWithSelector(AttestableASC.WrongChainKey.selector, 3, RealEvidence.CHAIN_KEY));
        asc.submitEvidence(id, _proof());
    }

    /// @notice If the precompile were ever to return false rather than revert.
    /// Spike 1.13 showed it reverts in practice, making this defensive.
    function test_RejectsFailedVerification() public {
        uint256 id = _openCover(_defaultPolicy());
        prover.setShouldVerify(false);

        vm.expectRevert(AttestableASC.ProofRejected.selector);
        asc.submitEvidence(id, _proof());
    }

    function test_RejectsInactiveCover() public {
        vm.prank(underwriter);
        uint256 id = cover.createCover{value: COLLATERAL}(_defaultPolicy(), PREMIUM); // OPEN, never bought

        vm.expectRevert(abi.encodeWithSelector(AttestableASC.CoverNotActive.selector, id));
        asc.submitEvidence(id, _proof());
    }

    // =================================================================
    // 2.7 — ASC and Cover working together
    // =================================================================

    /// @notice The vault must accept evidence ONLY from the registered ASC.
    function test_Wiring_CoverRejectsNonAscCaller() public {
        uint256 id = _openCover(_defaultPolicy());
        vm.prank(address(0xDEAD));
        vm.expectRevert(AttestableCover.NotAsc.selector);
        cover.recordEvidence(id, keccak256("x"), RealEvidence.EXPECTED_UPDATED_AT, 1, 1);
    }

    /// @notice Full path: real proof through the inspector, into the vault,
    /// updating policy state. This is the integration 2.7 asks for.
    function test_Wiring_EndToEnd_EvidenceReachesPolicyState() public {
        uint256 id = _openCover(_defaultPolicy());

        uint64 gapBefore = cover.projectedMaxGap(id);
        asc.submitEvidence(id, _proof());
        uint64 gapAfter = cover.projectedMaxGap(id);

        Cover memory c = cover.getCover(id);
        assertEq(c.evidenceCount, 1);
        assertLt(gapAfter, gapBefore, "recording evidence must shrink the projected worst gap");
    }

    /// @notice Replay must be caught at the vault, per-cover, even though the
    /// inspector would happily verify the same proof twice.
    function test_Wiring_ReplayRejectedAtVault() public {
        uint256 id = _openCover(_defaultPolicy());
        asc.submitEvidence(id, _proof());

        vm.expectRevert(); // AttestableCover.EvidenceAlreadyUsed
        asc.submitEvidence(id, _proof());

        assertEq(cover.getCover(id).evidenceCount, 1, "count must not increase");
    }

    /// @notice The same real update is legitimately evidence for two independent
    /// covers. Global consumption would let the first starve the second.
    function test_Wiring_SameEvidenceServesTwoCovers() public {
        uint256 a = _openCover(_defaultPolicy());
        uint256 b = _openCover(_defaultPolicy());

        asc.submitEvidence(a, _proof());
        asc.submitEvidence(b, _proof());

        assertEq(cover.getCover(a).evidenceCount, 1);
        assertEq(cover.getCover(b).evidenceCount, 1);
    }

    /// @notice Evidence outside the covered window must be refused even though
    /// the proof itself is perfectly valid.
    function test_Wiring_EvidenceOutsideWindowRejected() public {
        EvidencePolicy memory p = _defaultPolicy();
        p.windowStart = RealEvidence.EXPECTED_UPDATED_AT + 1 days;
        p.windowEnd = RealEvidence.EXPECTED_UPDATED_AT + 2 days;
        uint256 id = _openCover(p);

        vm.expectRevert(); // AttestableCover.EvidenceOutOfWindow
        asc.submitEvidence(id, _proof());
    }
}
