// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {AttestableCover} from "../contracts/AttestableCover.sol";
import {Cover, CoverStatus, EvidencePolicy} from "../contracts/AttestableTypes.sol";
import {IChainInfo} from "../contracts/interfaces/IChainInfo.sol";

/// @dev Stands in for the ChainInfo precompile, which does not exist on a local
/// EVM. Lets us drive the attestation-frontier gate deterministically.
contract MockChainInfo {
    uint64 public frontier;

    function setFrontier(uint64 h) external {
        frontier = h;
    }

    function is_height_attested(uint64, uint64 height) external view returns (bool) {
        return frontier >= height;
    }

    function get_latest_attestation_height_and_hash(uint64)
        external
        view
        returns (IChainInfo.HeightHashResult memory r)
    {
        r.height = frontier;
        r.exists = true;
        r.isAttestation = true;
    }
}

contract AttestableCoverTest is Test {
    AttestableCover cover;
    MockChainInfo chainInfo;

    address underwriter = makeAddr("underwriter");
    address buyer = makeAddr("buyer");
    address asc = makeAddr("asc");

    // Real values measured in the spike.
    uint64 constant AGG_CHAIN_KEY = 1;
    address constant AGGREGATOR = 0x719E22E3D4b690E5d96cCb40619180B5427F14AE;
    bytes32 constant ANSWER_UPDATED = 0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f;

    uint64 constant WINDOW_START = 1_788_000_000;
    uint64 constant WINDOW_END = WINDOW_START + 24 hours;
    uint64 constant WINDOW_END_BLOCK = 11_650_000;
    uint32 constant TOLERANCE = 5400; // 90 minutes — never 60; real max gap is 61.4 min

    uint256 constant COLLATERAL = 200_000 ether;
    uint256 constant PREMIUM = 12_000 ether;

    function setUp() public {
        chainInfo = new MockChainInfo();
        cover = new AttestableCover();
        // Inject the mock at the precompile address so the gate is testable.
        vm.etch(0x0000000000000000000000000000000000000fD3, address(chainInfo).code);
        chainInfo = MockChainInfo(0x0000000000000000000000000000000000000fD3);

        cover.setAsc(asc);
        vm.deal(underwriter, 1_000_000 ether);
        vm.deal(buyer, 1_000_000 ether);
    }

    function _policy() internal pure returns (EvidencePolicy memory p) {
        p = EvidencePolicy({
            chainKey: AGG_CHAIN_KEY,
            sourceContract: AGGREGATOR,
            eventSignature: ANSWER_UPDATED,
            windowStart: WINDOW_START,
            windowEnd: WINDOW_END,
            windowEndBlock: WINDOW_END_BLOCK,
            toleranceSecs: TOLERANCE
        });
    }

    function _openAndBuy() internal returns (uint256 id) {
        vm.prank(underwriter);
        id = cover.createCover{value: COLLATERAL}(_policy(), PREMIUM);
        vm.prank(buyer);
        cover.buyCover{value: PREMIUM}(id);
    }

    /// @dev Feed evidence on a fixed cadence from windowStart.
    function _feed(uint256 id, uint64 startOffset, uint64 spacing, uint256 count) internal {
        for (uint256 i = 0; i < count; i++) {
            uint64 ts = WINDOW_START + startOffset + uint64(i) * spacing;
            if (ts > WINDOW_END) break;
            vm.prank(asc);
            cover.recordEvidence(id, keccak256(abi.encode(id, ts)), ts, 239075000000, 35735 + i);
        }
    }

    // ---------------------------------------------------------------
    // 2.2 — cover creation and escrow
    // ---------------------------------------------------------------

    function test_CreateCover_HoldsCollateral() public {
        vm.prank(underwriter);
        uint256 id = cover.createCover{value: COLLATERAL}(_policy(), PREMIUM);

        Cover memory c = cover.getCover(id);
        assertEq(c.underwriter, underwriter);
        assertEq(c.collateral, COLLATERAL);
        assertEq(c.premium, PREMIUM);
        assertEq(uint8(c.status), uint8(CoverStatus.OPEN));
        assertEq(address(cover).balance, COLLATERAL, "collateral must be held by the contract");
    }

    function test_BuyCover_HoldsPremiumAndActivates() public {
        uint256 id = _openAndBuy();
        Cover memory c = cover.getCover(id);
        assertEq(c.buyer, buyer);
        assertEq(uint8(c.status), uint8(CoverStatus.ACTIVE));
        assertEq(address(cover).balance, COLLATERAL + PREMIUM, "both sides must be escrowed");
    }

    function test_BuyCover_RejectsWrongPremium() public {
        vm.prank(underwriter);
        uint256 id = cover.createCover{value: COLLATERAL}(_policy(), PREMIUM);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(AttestableCover.PremiumMismatch.selector, PREMIUM, PREMIUM - 1));
        cover.buyCover{value: PREMIUM - 1}(id);
    }

    function test_CancelCover_ReturnsCollateral() public {
        vm.prank(underwriter);
        uint256 id = cover.createCover{value: COLLATERAL}(_policy(), PREMIUM);
        uint256 before = underwriter.balance;

        vm.prank(underwriter);
        cover.cancelCover(id);

        assertEq(underwriter.balance, before + COLLATERAL);
        assertEq(address(cover).balance, 0);
    }

    // ---------------------------------------------------------------
    // Settlement — the max-interval policy
    // ---------------------------------------------------------------

    function test_Settle_Healthy_UnderwriterTakesAll() public {
        uint256 id = _openAndBuy();
        // Hourly updates across the whole window: max gap 3600s < 5400s tolerance.
        _feed(id, 3600, 3600, 24);

        vm.warp(WINDOW_END + 1); // window must actually have closed
        chainInfo.setFrontier(WINDOW_END_BLOCK);
        uint256 uBefore = underwriter.balance;
        uint256 bBefore = buyer.balance;

        cover.settle(id);

        Cover memory c = cover.getCover(id);
        assertEq(uint8(c.status), uint8(CoverStatus.HEALTHY));
        assertEq(underwriter.balance, uBefore + COLLATERAL + PREMIUM, "underwriter takes collateral + premium");
        assertEq(buyer.balance, bBefore, "buyer receives nothing when nothing failed");
        assertEq(address(cover).balance, 0, "escrow fully drained");
    }

    function test_Settle_Claimed_BuyerTakesCollateral() public {
        uint256 id = _openAndBuy();
        // Updates stop 6 hours in, leaving an 18-hour silence to the window end.
        _feed(id, 3600, 3600, 6);

        vm.warp(WINDOW_END + 1); // window must actually have closed
        chainInfo.setFrontier(WINDOW_END_BLOCK);
        uint256 uBefore = underwriter.balance;
        uint256 bBefore = buyer.balance;

        cover.settle(id);

        Cover memory c = cover.getCover(id);
        assertEq(uint8(c.status), uint8(CoverStatus.CLAIMED));
        assertGt(c.maxGap, TOLERANCE, "the breach must be recorded");
        assertEq(buyer.balance, bBefore + COLLATERAL, "buyer receives the collateral");
        assertEq(underwriter.balance, uBefore + PREMIUM, "underwriter keeps the premium");
        assertEq(address(cover).balance, 0, "escrow fully drained");
    }

    /// @notice The real 2026-08-31 outage: a 12.9-hour silence on a live feed.
    function test_Settle_RealWorldOutage_Claims() public {
        uint256 id = _openAndBuy();
        _feed(id, 3600, 3600, 3); // updates at +1h, +2h, +3h
        // then 12.9 hours of nothing
        uint64 resume = WINDOW_START + 3 hours + 46_416; // 773.6 min later
        vm.prank(asc);
        cover.recordEvidence(id, keccak256("resume"), resume, 239075000000, 40000);

        assertGt(cover.getCover(id).maxGap, TOLERANCE);

        vm.warp(WINDOW_END + 1); // window must actually have closed
        chainInfo.setFrontier(WINDOW_END_BLOCK);
        cover.settle(id);
        assertEq(uint8(cover.getCover(id).status), uint8(CoverStatus.CLAIMED));
    }

    /// @notice A 61.4-minute gap is what a HEALTHY feed really does. A 60-minute
    /// tolerance would wrongly claim against it; 90 minutes correctly does not.
    function test_Settle_MeasuredWorstCaseGap_StaysHealthy() public {
        uint256 id = _openAndBuy();
        uint64 realMaxGap = 3684; // 61.4 minutes, measured in spike 1.5
        for (uint256 i = 1; i <= 23; i++) {
            uint64 ts = WINDOW_START + uint64(i) * realMaxGap;
            if (ts > WINDOW_END) break;
            vm.prank(asc);
            cover.recordEvidence(id, keccak256(abi.encode(i)), ts, 239075000000, i);
        }
        assertLe(cover.getCover(id).maxGap, TOLERANCE, "90-min tolerance must survive the real worst case");
    }

    function test_Settle_NoEvidenceAtAll_Claims() public {
        uint256 id = _openAndBuy();
        vm.warp(WINDOW_END + 1); // window must actually have closed
        chainInfo.setFrontier(WINDOW_END_BLOCK);
        cover.settle(id);
        assertEq(uint8(cover.getCover(id).status), uint8(CoverStatus.CLAIMED));
    }

    // ---------------------------------------------------------------
    // Guards
    // ---------------------------------------------------------------

    function test_RecordEvidence_OnlyAsc() public {
        uint256 id = _openAndBuy();
        vm.prank(buyer);
        vm.expectRevert(AttestableCover.NotAsc.selector);
        cover.recordEvidence(id, keccak256("x"), WINDOW_START + 60, 1, 1);
    }

    function test_RecordEvidence_RejectsReplay() public {
        uint256 id = _openAndBuy();
        bytes32 q = keccak256("dup");
        vm.prank(asc);
        cover.recordEvidence(id, q, WINDOW_START + 3600, 1, 1);
        vm.prank(asc);
        vm.expectRevert(abi.encodeWithSelector(AttestableCover.EvidenceAlreadyUsed.selector, q));
        cover.recordEvidence(id, q, WINDOW_START + 7200, 1, 1);
    }

    /// @notice The same source event is legitimately valid evidence for two
    /// independent covers. Consuming it globally would let one cover starve another.
    function test_RecordEvidence_SameQueryAcrossTwoCovers_BothAccepted() public {
        uint256 a = _openAndBuy();
        uint256 b = _openAndBuy();
        bytes32 q = keccak256("shared");

        vm.prank(asc);
        cover.recordEvidence(a, q, WINDOW_START + 3600, 1, 1);
        vm.prank(asc);
        cover.recordEvidence(b, q, WINDOW_START + 3600, 1, 1);

        assertEq(cover.getCover(a).evidenceCount, 1);
        assertEq(cover.getCover(b).evidenceCount, 1);
    }

    function test_RecordEvidence_RejectsOutOfOrder() public {
        uint256 id = _openAndBuy();
        vm.prank(asc);
        cover.recordEvidence(id, keccak256("a"), WINDOW_START + 7200, 1, 1);
        vm.prank(asc);
        vm.expectRevert(
            abi.encodeWithSelector(
                AttestableCover.EvidenceOutOfOrder.selector, WINDOW_START + 3600, WINDOW_START + 7200
            )
        );
        cover.recordEvidence(id, keccak256("b"), WINDOW_START + 3600, 1, 1);
    }

    function test_RecordEvidence_RejectsOutsideWindow() public {
        uint256 id = _openAndBuy();
        vm.prank(asc);
        vm.expectRevert(
            abi.encodeWithSelector(
                AttestableCover.EvidenceOutOfWindow.selector, WINDOW_END + 1, WINDOW_START, WINDOW_END
            )
        );
        cover.recordEvidence(id, keccak256("late"), WINDOW_END + 1, 1, 1);
    }

    /// @notice Settlement must not be possible before Attestcoin could have
    /// supplied the evidence — otherwise attestor lag alone would trigger payouts.
    function test_Settle_BlockedUntilAttestationFrontierPasses() public {
        uint256 id = _openAndBuy();
        vm.warp(WINDOW_END + 1);
        chainInfo.setFrontier(WINDOW_END_BLOCK - 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                AttestableCover.WindowNotAttested.selector, WINDOW_END_BLOCK, WINDOW_END_BLOCK - 1
            )
        );
        cover.settle(id);

        vm.warp(WINDOW_END + 1); // window must actually have closed
        chainInfo.setFrontier(WINDOW_END_BLOCK);
        cover.settle(id); // now permitted
    }

    function test_Settle_CannotSettleTwice() public {
        uint256 id = _openAndBuy();
        vm.warp(WINDOW_END + 1); // window must actually have closed
        chainInfo.setFrontier(WINDOW_END_BLOCK);
        cover.settle(id);
        vm.expectRevert(
            abi.encodeWithSelector(AttestableCover.WrongStatus.selector, CoverStatus.ACTIVE, CoverStatus.CLAIMED)
        );
        cover.settle(id);
    }

    /// @notice Money in must equal money out, on both branches.
    function testFuzz_EscrowConservation(bool healthy) public {
        uint256 id = _openAndBuy();
        if (healthy) _feed(id, 3600, 3600, 24);

        uint256 uBefore = underwriter.balance;
        uint256 bBefore = buyer.balance;

        vm.warp(WINDOW_END + 1); // window must actually have closed
        chainInfo.setFrontier(WINDOW_END_BLOCK);
        cover.settle(id);

        uint256 paidOut = (underwriter.balance - uBefore) + (buyer.balance - bBefore);
        assertEq(paidOut, COLLATERAL + PREMIUM, "every wei in must come out");
        assertEq(address(cover).balance, 0);
    }
}
