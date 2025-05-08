// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract AiverseCoin is ERC20, Ownable {
    uint256 public constant HALVING_PERIOD_DAYS = 1460;
    uint256 public constant MAX_TOTAL_SUPPLY = 2_100_000_000 ether;

    uint256 public initialDailyReward;
    uint256 public startDay;
    address public stakeController;
    uint256 public lastMintedDay;

    constructor(
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        startDay = block.timestamp / 1 days;
        initialDailyReward = (MAX_TOTAL_SUPPLY / 2) / HALVING_PERIOD_DAYS;
    }

    function setStakeController(address _stakeController) external onlyOwner {
        stakeController = _stakeController;
    }

    function mintToken() external onlyOwner {
        uint256 currentDay = block.timestamp / 1 days;
        require(currentDay > lastMintedDay, "Already minted for today");

        uint256 amount = getMintAmountByDay(currentDay);
        require(
            totalSupply() + amount <= MAX_TOTAL_SUPPLY,
            "Exceeds max supply"
        );

        lastMintedDay = currentDay;
        _mint(address(this), amount);
    }

    function userClaimToken(address userAddr, uint256 amount) external {
        require(msg.sender == stakeController, "Only StakeController can transfer");
        _transfer(address(this), userAddr, amount);
    }

    function getMintAmountByDay(uint256 day) public view returns (uint256) {
        require(day >= startDay, "Invalid day");

        uint256 daysSinceStart = day - startDay;
        uint256 halvingEra = daysSinceStart / HALVING_PERIOD_DAYS;

        uint256 reward = initialDailyReward >> halvingEra;
        return reward;
    }
}
