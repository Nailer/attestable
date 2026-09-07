// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {EvidencePolicy} from "../AttestableTypes.sol";

/// @notice The narrow surface AttestableASC needs from AttestableCover.
/// Deliberately minimal: the inspector reads a policy and reports one verified
/// fact. It never sees, holds or moves money.
interface IAttestableCover {
    function getPolicy(uint256 coverId) external view returns (EvidencePolicy memory);

    function isActive(uint256 coverId) external view returns (bool);

    /// @notice Report a piece of evidence that has already passed every
    /// verification check. Callable only by the registered ASC.
    /// @param updatedAt The event's own timestamp — the value the max-interval
    /// policy is evaluated against.
    function recordEvidence(uint256 coverId, bytes32 queryId, uint64 updatedAt, int256 price, uint256 roundId)
        external;
}
