// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {EvmV1Decoder} from "@gluwa/usc-contracts/contracts/decoding/EvmV1Decoder.sol";
import {INativeQueryVerifier, NativeQueryVerifierLib} from "../interfaces/INativeQueryVerifier.sol";

/// @title SpikeVerifier
/// @notice Throwaway contract for Phase-1 spike step 1.12. Its only job is to
/// prove the pipeline end to end:
///
///   real Chainlink event on Sepolia
///     -> Attestcoin proof
///       -> verification here, on Creditcoin
///         -> a real state change
///
/// This is NOT the production contract. AttestableASC and AttestableCover come in
/// Phase 2. Everything here is deliberately minimal: no escrow, no policy, no
/// settlement — just the six checks that must hold before any evidence can be
/// trusted, plus a counter so the state change is observable on-chain.
contract SpikeVerifier {
    INativeQueryVerifier public immutable VERIFIER;

    /// @dev keccak256("AnswerUpdated(int256,uint256,uint256)")
    /// A Solidity event signature hashes parameter TYPES only — indexing does not
    /// change it. So matching this hash does NOT confirm the parameter layout,
    /// which is why the topic/data length assertions below are load-bearing.
    bytes32 public constant ANSWER_UPDATED =
        0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f;

    /// @notice The Chainlink ETH/USD aggregator on Sepolia — the real emitter,
    /// resolved from the proxy in spike step 1.3. Binding to the proxy instead
    /// would match nothing: the proxy forwards calls but emits no events.
    address public immutable EXPECTED_EMITTER;

    /// @notice Attestcoin's identifier for the source chain (1 = Sepolia).
    uint64 public immutable EXPECTED_CHAIN_KEY;

    /// @notice Replay protection. Keyed on the query identity, so the same piece
    /// of evidence cannot be counted twice.
    mapping(bytes32 => bool) public consumedQueries;

    uint256 public acceptedCount;

    /// @dev chainKey and emitter are deliberately omitted — both are immutables
    /// readable from the contract, and carrying them here pushed `submitEvidence`
    /// over the EVM's 16-slot stack limit.
    event ProofAccepted(
        bytes32 indexed queryId,
        uint64 indexed blockHeight,
        int256 price,
        uint256 roundId,
        uint256 updatedAt
    );

    error AlreadyConsumed(bytes32 queryId);
    error WrongChainKey(uint64 expected, uint64 got);
    error ProofRejected();
    error UnsupportedTransactionType(uint8 txType);
    error SourceTransactionFailed(uint8 receiptStatus);
    error NoMatchingEvent();
    error WrongEmitter(address expected, address got);
    error MalformedEvent(uint256 topicCount, uint256 dataLength);

    constructor(address expectedEmitter, uint64 expectedChainKey) {
        VERIFIER = NativeQueryVerifierLib.getVerifier();
        EXPECTED_EMITTER = expectedEmitter;
        EXPECTED_CHAIN_KEY = expectedChainKey;
    }

    /// @notice Submit an Attestcoin proof of a Chainlink price update.
    /// @dev Permissionless by design. Nothing here trusts the caller — every
    /// claim is checked against the proof itself, so a hostile submitter can only
    /// waste their own gas.
    function submitEvidence(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external returns (bytes32 queryId) {
        // CHECK 1 — the evidence must come from the source chain we expect.
        if (chainKey != EXPECTED_CHAIN_KEY) revert WrongChainKey(EXPECTED_CHAIN_KEY, chainKey);

        // CHECK 2 — this exact evidence must not have been used before.
        queryId = _computeQueryId(chainKey, blockHeight, merkleRoot, siblings);
        if (consumedQueries[queryId]) revert AlreadyConsumed(queryId);

        // CHECK 3 — the transaction genuinely exists in that block, and that
        // block genuinely belongs to the attested source chain. This is the
        // Attestcoin guarantee; without it everything below is just hearsay.
        // Scoped so the proof structs drop off the stack before decoding.
        {
            bool verified = VERIFIER.verifyAndEmit(
                chainKey,
                blockHeight,
                encodedTransaction,
                INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings}),
                INativeQueryVerifier.ContinuityProof({
                    lowerEndpointDigest: lowerEndpointDigest,
                    roots: continuityRoots
                })
            );
            if (!verified) revert ProofRejected();
        }

        // Mark consumed only after verification succeeds, so a failed submission
        // does not burn a legitimate query id.
        consumedQueries[queryId] = true;

        (int256 price, uint256 roundId, uint256 updatedAt) = _decodeAndValidate(encodedTransaction);

        acceptedCount += 1;

        emit ProofAccepted(queryId, blockHeight, price, roundId, updatedAt);
    }

    /// @dev `view` rather than `pure` because it reads the EXPECTED_EMITTER immutable.
    function _decodeAndValidate(bytes calldata encodedTransaction)
        internal
        view
        returns (int256 price, uint256 roundId, uint256 updatedAt)
    {
        uint8 txType = EvmV1Decoder.getTransactionType(encodedTransaction);
        if (!EvmV1Decoder.isValidTransactionType(txType)) revert UnsupportedTransactionType(txType);

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);

        // CHECK 4 — the precompile proves inclusion, NOT success. A reverted
        // transaction is still genuinely included in its block, so this check is
        // the only thing standing between us and settling on a failed update.
        if (receipt.receiptStatus != 1) revert SourceTransactionFailed(receipt.receiptStatus);

        EvmV1Decoder.LogEntry[] memory logs = EvmV1Decoder.getLogsByEventSignature(receipt, ANSWER_UPDATED);
        if (logs.length == 0) revert NoMatchingEvent();

        EvmV1Decoder.LogEntry memory log = logs[0];

        // CHECK 5 — the event must come from the real aggregator. Without this,
        // anyone could deploy a contract emitting an identical-looking event,
        // prove it honestly, and feed us fabricated prices. The proof would be
        // valid; the evidence would be worthless.
        if (log.address_ != EXPECTED_EMITTER) revert WrongEmitter(EXPECTED_EMITTER, log.address_);

        // CHECK 6 — shape. Verified against real logs in spike 1.8A:
        //   topics[0] = ANSWER_UPDATED
        //   topics[1] = int256  indexed current  (price, 8 decimals)
        //   topics[2] = uint256 indexed roundId
        //   data      = uint256 updatedAt        (exactly one 32-byte word)
        // The signature hash is identical whether or not parameters are indexed,
        // so this shape check is what actually pins the layout down.
        if (log.topics.length != 3 || log.data.length != 32) {
            revert MalformedEvent(log.topics.length, log.data.length);
        }

        price = int256(uint256(log.topics[1]));
        roundId = uint256(log.topics[2]);
        updatedAt = abi.decode(log.data, (uint256));
    }

    /// @dev Identifies a query by where it sits on the source chain: which chain,
    /// which block, which position within that block. Same derivation the
    /// reference implementation uses.
    function _computeQueryId(
        uint64 chainKey,
        uint64 blockHeight,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings
    ) internal view returns (bytes32 queryId) {
        uint256 txIndex =
            VERIFIER.calculateTxIndex(INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings}));

        assembly {
            let ptr := mload(0x40)
            mstore(ptr, chainKey)
            mstore(add(ptr, 32), shl(192, blockHeight))
            mstore(add(ptr, 40), txIndex)
            queryId := keccak256(ptr, 72)
        }
    }
}
