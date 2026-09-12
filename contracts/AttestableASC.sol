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
    /// @dev More than one log in the transaction matched both the policy's event
    /// signature AND its source contract. Which one constitutes "the evidence"
    /// is then genuinely ambiguous, so we refuse rather than guess.
    error AmbiguousEvidence(uint256 matchCount);

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

        // Evidence identity is computed AFTER decoding, because it must include
        // which log within the transaction was used — see _decode.

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

        (int256 price, uint256 roundId, uint64 updatedAt, uint256 logIndex) =
            _decode(proof.encodedTransaction, policy);

        // Evidence identity is EVENT-level, not transaction-level.
        //
        // A transaction can contain several logs. Identifying evidence only by
        // (chain, block, txIndex) would make two distinct events inside the same
        // transaction indistinguishable — so consuming one would silently
        // consume the other. logIndex is what makes each piece of evidence
        // uniquely addressable.
        queryId = _evidenceId(proof, logIndex);

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
        returns (int256 price, uint256 roundId, uint64 updatedAt, uint256 logIndex)
    {
        uint8 txType = EvmV1Decoder.getTransactionType(encodedTransaction);
        if (!EvmV1Decoder.isValidTransactionType(txType)) revert UnsupportedTransactionType(txType);

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);

        // CHECK 3 — the precompile proves INCLUSION, not SUCCESS. A reverted
        // transaction is still genuinely inside its block. Omitting this would
        // let a failed price update settle a cover.
        if (receipt.receiptStatus != 1) revert SourceTransactionFailed(receipt.receiptStatus);

        // CHECK 4 — select the evidence log UNAMBIGUOUSLY.
        //
        // The receipt's logs are scanned directly rather than via
        // getLogsByEventSignature(), for two reasons:
        //
        //  1. That helper matches on signature ALONE. A transaction can contain
        //     the same event emitted by a DIFFERENT contract, so taking its
        //     first result could hand us a lookalike event from an impostor
        //     while the emitter check passes on the wrong log entirely. We match
        //     on signature AND emitter together.
        //
        //  2. It discards position. Evidence identity must be event-level (see
        //     _evidenceId), and LogEntry carries no index — so the index has to
        //     be recovered from the scan itself.
        //
        // Spike 1.4 measured a single Chainlink update emitting THREE events in
        // one transaction, so multiple matches are a real scenario here, not a
        // theoretical one.
        uint256 matches;
        EvmV1Decoder.LogEntry memory log;
        for (uint256 i = 0; i < receipt.receiptLogs.length; i++) {
            EvmV1Decoder.LogEntry memory candidate = receipt.receiptLogs[i];
            if (candidate.topics.length == 0) continue;
            if (candidate.topics[0] != policy.eventSignature) continue;
            if (candidate.address_ != policy.sourceContract) continue;
            matches++;
            log = candidate;
            logIndex = i;
        }

        if (matches == 0) {
            // Distinguish "no such event at all" from "right event, wrong
            // emitter" — the second is the impostor attack and deserves its own
            // error so rejection tests can assert which defence fired.
            for (uint256 i = 0; i < receipt.receiptLogs.length; i++) {
                EvmV1Decoder.LogEntry memory candidate = receipt.receiptLogs[i];
                if (candidate.topics.length > 0 && candidate.topics[0] == policy.eventSignature) {
                    revert WrongEmitter(policy.sourceContract, candidate.address_);
                }
            }
            revert NoMatchingEvent(policy.eventSignature);
        }

        // THE ATTACK THIS BLOCKS: an impostor contract emitting an
        // identically-shaped event with an invented price, proven honestly. The
        // proof is real; the evidence is worthless. Rejected live in spike 1.13.
        if (matches > 1) revert AmbiguousEvidence(matches);

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

    /// @dev Identifies one piece of evidence by its exact position on the source
    /// chain: which chain, which block, which transaction, and which log inside
    /// that transaction.
    ///
    /// `logIndex` is the part that matters. Without it the identity is
    /// transaction-level, so two distinct events inside the same transaction
    /// collide — consuming one would silently consume the other, and a cover
    /// could be denied evidence it was entitled to.
    function _evidenceId(ProofData calldata proof, uint256 logIndex) private view returns (bytes32) {
        uint256 txIndex = VERIFIER.calculateTxIndex(
            INativeQueryVerifier.MerkleProof({root: proof.merkleRoot, siblings: proof.siblings})
        );
        return keccak256(abi.encode(proof.chainKey, proof.blockHeight, txIndex, logIndex));
    }
}
