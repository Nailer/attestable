// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title INativeQueryVerifier
/// @notice Binding for Creditcoin's Block Prover precompile. The address and
/// signatures here are fixed by the Attestcoin Protocol — every Attestcoin Smart
/// Contract talks to the same precompile through this same interface.
///
/// The precompile answers exactly one question: "does this transaction genuinely
/// exist in this block on that source chain?" It proves inclusion via a Merkle
/// proof, and proves the block belongs to the attested chain via a continuity
/// proof.
///
/// IMPORTANT: it does NOT tell you whether the transaction succeeded. Callers
/// must decode the receipt and check the status field themselves.
interface INativeQueryVerifier {
    struct MerkleProofEntry {
        bytes32 hash;
        bool isLeft;
    }

    /// @notice Proves a transaction is included in a block's transaction trie.
    struct MerkleProof {
        bytes32 root;
        MerkleProofEntry[] siblings;
    }

    /// @notice Proves the block containing the transaction descends from a block
    /// the attestor set has signed off on.
    struct ContinuityProof {
        bytes32 lowerEndpointDigest;
        bytes32[] roots;
    }

    function verifyAndEmit(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external returns (bool);

    function calculateTxIndex(MerkleProof calldata merkleProof) external view returns (uint64);
}

library NativeQueryVerifierLib {
    /// @dev 0x0FD2 — native runtime precompile. `eth_getCode` returns nothing for
    /// this address, which is expected: it is Rust in the node, not EVM bytecode.
    address internal constant PRECOMPILE_ADDRESS = 0x0000000000000000000000000000000000000FD2;

    function getVerifier() internal pure returns (INativeQueryVerifier) {
        return INativeQueryVerifier(PRECOMPILE_ADDRESS);
    }
}
