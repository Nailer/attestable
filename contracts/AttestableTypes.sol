// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {INativeQueryVerifier} from "./interfaces/INativeQueryVerifier.sol";

/// @notice Everything the policy needs to identify acceptable evidence. Stored as
/// DATA, never hardcoded — so covering a different Chainlink feed (BTC/USD, gold,
/// FX) needs no new code, only different values here.
struct EvidencePolicy {
    /// @dev Attestcoin's source-chain identifier. 1 = Ethereum Sepolia.
    uint64 chainKey;
    /// @dev The contract that must have emitted the event. For Chainlink this is
    /// the AGGREGATOR, never the proxy — the proxy forwards calls but emits
    /// nothing, verified empirically in spike 1.3.
    address sourceContract;
    /// @dev keccak256 of the event signature. Note this hashes parameter TYPES
    /// only, so it does not pin down which parameters are indexed — the shape
    /// assertions in AttestableASC do that.
    bytes32 eventSignature;
    /// @dev Coverage window, in unix seconds. Compared against the event's own
    /// `updatedAt`, never a block timestamp.
    uint64 windowStart;
    uint64 windowEnd;
    /// @dev Source-chain block height at/after windowEnd. Settlement waits for
    /// Attestcoin's attestation frontier to pass this, so a lagging attestor set
    /// can never itself cause a payout.
    uint64 windowEndBlock;
    /// @dev Maximum permitted silence between consecutive updates, in seconds.
    /// MUST exceed the feed's real worst-case gap. Measured at 61.4 min for
    /// Sepolia ETH/USD in spike 1.5, so its nominal 3600s heartbeat is an UNSAFE
    /// tolerance. 5400 (90 min) is the recommended value.
    uint32 toleranceSecs;
}

/// @notice Lifecycle of a cover.
/// OPEN     — underwriter has posted collateral, waiting for a buyer
/// ACTIVE   — buyer has paid the premium; evidence may be recorded
/// HEALTHY  — settled, no gap exceeded tolerance; underwriter takes everything
/// CLAIMED  — settled, a gap exceeded tolerance; buyer takes the collateral
/// CANCELLED— never bought, underwriter withdrew their collateral
enum CoverStatus {
    OPEN,
    ACTIVE,
    HEALTHY,
    CLAIMED,
    CANCELLED
}

/// @notice A single cover. Terms are immutable once ACTIVE.
struct Cover {
    address buyer;
    address underwriter;
    uint256 premium;
    uint256 collateral;
    EvidencePolicy policy;
    CoverStatus status;
    // --- incremental max-interval state ---
    // Evaluating "no gap exceeded tolerance" naively would mean storing every
    // timestamp and sorting at settlement. Instead evidence must arrive in
    // chronological order and we keep only two numbers, making each submission
    // O(1) with no arrays and no sorting.
    /// @dev `updatedAt` of the most recent accepted evidence. 0 = none yet.
    uint64 lastTimestamp;
    /// @dev Largest silence observed so far, in seconds.
    uint64 maxGap;
    /// @dev How many distinct pieces of evidence have been accepted.
    uint32 evidenceCount;
}

/// @notice Proof bundle as returned by the Attestcoin Proof Builder. Passed as a
/// struct rather than flat arguments to keep `submitEvidence` inside the EVM's
/// 16-slot stack limit.
struct ProofData {
    uint64 chainKey;
    uint64 blockHeight;
    bytes encodedTransaction;
    bytes32 merkleRoot;
    INativeQueryVerifier.MerkleProofEntry[] siblings;
    bytes32 lowerEndpointDigest;
    bytes32[] continuityRoots;
}
