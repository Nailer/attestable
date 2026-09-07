// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title IChainInfo
/// @notice Binding for Creditcoin's ChainInfo precompile at 0x0FD3. Signatures
/// are taken verbatim from the SDK's published ABI (`chain_info.json`) — note
/// they are snake_case, unlike the camelCase wrappers the JavaScript SDK exposes.
///
/// This is Attestable's second Attestcoin surface. The Block Prover (0x0FD2)
/// answers "did this happen?"; ChainInfo answers "is the network far enough
/// along that a proof COULD have been supplied by now?" — which is what makes an
/// absence-of-evidence outcome honest rather than an artefact of attestor lag.
interface IChainInfo {
    struct HeightHashResult {
        uint64 height;
        bytes32 hash;
        bool isAttestation;
        bool exists;
    }

    /// @notice True once the attestation frontier for `chainKey` has reached
    /// `height`, meaning evidence at that height is provable.
    function is_height_attested(uint64 chainKey, uint64 height) external view returns (bool isAttested);

    function get_latest_attestation_height_and_hash(uint64 chainKey)
        external
        view
        returns (HeightHashResult memory result);
}

library ChainInfoLib {
    /// @dev 0x0FD3 — native runtime precompile. `eth_getCode` returns nothing
    /// here, which is expected: it is Rust in the node, not EVM bytecode.
    address internal constant PRECOMPILE_ADDRESS = 0x0000000000000000000000000000000000000fD3;

    function getChainInfo() internal pure returns (IChainInfo) {
        return IChainInfo(PRECOMPILE_ADDRESS);
    }
}
