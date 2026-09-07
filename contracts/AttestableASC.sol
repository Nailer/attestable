// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {EvmV1Decoder} from "@gluwa/usc-contracts/contracts/decoding/EvmV1Decoder.sol";
import {INativeQueryVerifier, NativeQueryVerifierLib} from "./interfaces/INativeQueryVerifier.sol";
import {IAttestableCover} from "./interfaces/IAttestableCover.sol";
import {EvidencePolicy, ProofData} from "./AttestableTypes.sol";

/// @title AttestableASC
/// @notice The inspector. Attestable's Attestcoin Smart Contract.
///
/// Takes an Attestcoin proof of something that happened on another chain, runs
/// every check that stands between "this proof is valid" and "this evidence is
/// meaningful", and reports exactly one fact onward: a genuine price update
/// occurred at time T.
///
/// It never holds, sees or moves money. That separation is deliberate — the
/// security-critical code stays small enough to audit in one sitting, while the
/// settlement logic it feeds can evolve independently.
///
/// THE DISTINCTION THIS CONTRACT EXISTS TO ENFORCE:
/// Cryptography proves that something HAPPENED. It cannot prove that the
/// something was MEANINGFUL. Anyone can deploy a contract that emits a
/// fabricated price, then obtain a perfectly genuine proof of it. Checks 4-6
/// below are what separate a valid proof from useful evidence.
contract AttestableASC {
    INativeQueryVerifier public immutable VERIFIER;
    IAttestableCover public immutable COVER;

    mapping(bytes32 => bool) public seenQueries;

    /// @dev Mirrors the decoded event for the UI. The Cover contract only needs
    /// the timestamp; price and roundId are surfaced here for the explorer.
    event EvidenceVerified(
        uint256 indexed coverId,
        bytes32 indexed queryId,
        uint64 indexed sourceBlock,
        address emitter,
        int256 price,
        uint256 roundId,
        uint64 updatedAt
    );

    error CoverNotActive(uint256 coverId);
    error WrongChainKey(uint64 expected, uint64 got);
    error ProofRejected();
    error UnsupportedTransactionType(uint8 txType);
    error SourceTransactionFailed(uint8 receiptStatus);
    error NoMatchingEvent(bytes32 eventSignature);
    error WrongEmitter(address expected, address got);
    error MalformedEvent(uint256 topicCount, uint256 dataLength);

    constructor(address cover) {
        VERIFIER = NativeQueryVerifierLib.getVerifier();
        COVER = IAttestableCover(cover);
    }

    /// @notice Submit proof of one source-chain price update against a cover.
    ///
    /// Permissionless by design. Nothing here trusts the caller — every claim is
    /// checked against the proof itself, so a hostile submitter can only waste
    /// their own gas. This matters economically: the underwriter profits from a
    /// HEALTHY outcome and is therefore motivated to submit evidence, while
    /// nobody can suppress evidence to manufacture a claim.
    function submitEvidence(uint256 coverId, ProofData calldata proof) external returns (bytes32 queryId) {
        if (!COVER.isActive(coverId)) revert CoverNotActive(coverId);

        EvidencePolicy memory policy = COVER.getPolicy(coverId);

        // CHECK 1 — evidence must come from the source chain this cover names.
        if (proof.chainKey != policy.chainKey) revert WrongChainKey(policy.chainKey, proof.chainKey);

        queryId = _computeQueryId(proof);

        // CHECK 2 — cryptographic verification. Inclusion in the block, and that
        // block's descent from an attested one. Everything below is hearsay
        // without this.
        //
        // Note from spike 1.13: the precompile REVERTS on a bad proof rather
        // than returning false, so ProofRejected is defensive and unreachable in
        // practice. Kept because relying on undocumented revert behaviour would
        // be worse than a redundant check.
        {
            bool ok = VERIFIER.verifyAndEmit(
                proof.chainKey,
                proof.blockHeight,
                proof.encodedTransaction,
                INativeQueryVerifier.MerkleProof({root: proof.merkleRoot, siblings: proof.siblings}),
                INativeQueryVerifier.ContinuityProof({
                    lowerEndpointDigest: proof.lowerEndpointDigest,
                    roots: proof.continuityRoots
                })
            );
            if (!ok) revert ProofRejected();
        }

        seenQueries[queryId] = true;

        (int256 price, uint256 roundId, uint64 updatedAt) = _decode(proof.encodedTransaction, policy);

        emit EvidenceVerified(
            coverId, queryId, proof.blockHeight, policy.sourceContract, price, roundId, updatedAt
        );

        // Per-cover replay protection and all policy maths live in the vault.
        COVER.recordEvidence(coverId, queryId, updatedAt, price, roundId);
    }

    /// @dev Checks 3-6. Separated so the proof structs leave the stack first,
    /// keeping submitEvidence within the EVM's 16-slot limit.
    function _decode(bytes calldata encodedTransaction, EvidencePolicy memory policy)
        private
        pure
        returns (int256 price, uint256 roundId, uint64 updatedAt)
    {
        uint8 txType = EvmV1Decoder.getTransactionType(encodedTransaction);
        if (!EvmV1Decoder.isValidTransactionType(txType)) revert UnsupportedTransactionType(txType);

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);

        // CHECK 3 — the precompile proves INCLUSION, not SUCCESS. A reverted
        // transaction is still genuinely inside its block. Omitting this would
        // let a failed price update settle a cover.
        if (receipt.receiptStatus != 1) revert SourceTransactionFailed(receipt.receiptStatus);

        EvmV1Decoder.LogEntry[] memory logs =
            EvmV1Decoder.getLogsByEventSignature(receipt, policy.eventSignature);
        if (logs.length == 0) revert NoMatchingEvent(policy.eventSignature);

        EvmV1Decoder.LogEntry memory log = logs[0];

        // CHECK 4 — the event must come from the contract this policy names.
        // THE ATTACK THIS BLOCKS: deploy a lookalike contract, emit an
        // identically-shaped event carrying an invented price, and obtain a
        // completely honest proof of it. The proof is real; the evidence is
        // worthless. Verified rejected in spike 1.13 attack A5.
        if (log.address_ != policy.sourceContract) revert WrongEmitter(policy.sourceContract, log.address_);

        // CHECK 5 — shape, verified against real logs in spike 1.8A:
        //   topics[0] = event signature
        //   topics[1] = int256  indexed current  (price, 8 decimals)
        //   topics[2] = uint256 indexed roundId
        //   data      = uint256 updatedAt        (exactly one word)
        // A signature hash covers parameter TYPES only, so it is identical
        // whether or not parameters are indexed. This assertion — not the hash —
        // is what actually pins the layout down. Getting this wrong reads the
        // price from the wrong slot while every signature check still passes.
        if (log.topics.length != 3 || log.data.length != 32) {
            revert MalformedEvent(log.topics.length, log.data.length);
        }

        price = int256(uint256(log.topics[1]));
        roundId = uint256(log.topics[2]);
        // CHECK 6 — the timestamp comes from the event's own data, which the
        // receipt proof covers. The block timestamp is a header field the proof
        // does NOT cover, so using it would add a trust assumption for nothing.
        updatedAt = uint64(abi.decode(log.data, (uint256)));
    }

    /// @dev Identifies a query by its position on the source chain: which chain,
    /// which block, which index within that block.
    function _computeQueryId(ProofData calldata proof) private view returns (bytes32 queryId) {
        uint256 txIndex = VERIFIER.calculateTxIndex(
            INativeQueryVerifier.MerkleProof({root: proof.merkleRoot, siblings: proof.siblings})
        );
        uint64 chainKey = proof.chainKey;
        uint64 blockHeight = proof.blockHeight;

        assembly {
            let ptr := mload(0x40)
            mstore(ptr, chainKey)
            mstore(add(ptr, 32), shl(192, blockHeight))
            mstore(add(ptr, 40), txIndex)
            queryId := keccak256(ptr, 72)
        }
    }
}
