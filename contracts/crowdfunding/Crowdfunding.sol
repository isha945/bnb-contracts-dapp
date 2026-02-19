// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract CrowdfundingDApp {
    struct Campaign {
        uint256 id;
        address payable creator;
        string  title;
        string  description;
        string  imageUrl;
        uint256 goalAmount;       // in wei
        uint256 raisedAmount;
        uint256 deadline;         // unix timestamp
        bool    goalReached;
        bool    fundsWithdrawn;
        bool    isCancelled;
        uint256 backerCount;
    }

    address public owner;
    uint256 public campaignCount;
    uint256 public platformFeePercent = 2;   // 2 %

    mapping(uint256 => Campaign)                       public campaigns;
    mapping(uint256 => mapping(address => uint256))    private contributions;

    // ── Events ───────────────────────────────────────────────────────
    event CampaignCreated (uint256 indexed campaignId, address indexed creator, string title, uint256 goalAmount);
    event CampaignFunded  (uint256 indexed campaignId, address indexed backer,  uint256 amount);
    event FundsWithdrawn  (uint256 indexed campaignId, uint256 amount);
    event RefundClaimed   (uint256 indexed campaignId, address indexed backer,  uint256 amount);
    event CampaignCancelled(uint256 indexed campaignId);

    // ── Modifiers ────────────────────────────────────────────────────
    modifier onlyOwner()               { require(msg.sender == owner, "Not owner");       _; }
    modifier campaignExists(uint256 _id) { require(_id > 0 && _id <= campaignCount, "No campaign"); _; }

    constructor() { owner = msg.sender; }

    // ── Create ───────────────────────────────────────────────────────
    function createCampaign(
        string memory _title,
        string memory _description,
        string memory _imageUrl,
        uint256 _goalAmount,
        uint256 _durationDays
    ) external {
        require(bytes(_title).length > 0, "Title required");
        require(_goalAmount > 0, "Goal must be > 0");
        require(_durationDays > 0, "Duration must be > 0");

        campaignCount++;
        campaigns[campaignCount] = Campaign({
            id:             campaignCount,
            creator:        payable(msg.sender),
            title:          _title,
            description:    _description,
            imageUrl:       _imageUrl,
            goalAmount:     _goalAmount,
            raisedAmount:   0,
            deadline:       block.timestamp + (_durationDays * 1 days),
            goalReached:    false,
            fundsWithdrawn: false,
            isCancelled:    false,
            backerCount:    0
        });
        emit CampaignCreated(campaignCount, msg.sender, _title, _goalAmount);
    }

    // ── Fund ─────────────────────────────────────────────────────────
    function fundCampaign(uint256 _campaignId) external payable campaignExists(_campaignId) {
        Campaign storage c = campaigns[_campaignId];
        require(!c.isCancelled,      "Campaign cancelled");
        require(block.timestamp < c.deadline, "Deadline passed");
        require(msg.value > 0,       "Send BNB");

        if (contributions[_campaignId][msg.sender] == 0) {
            c.backerCount++;
        }
        contributions[_campaignId][msg.sender] += msg.value;
        c.raisedAmount += msg.value;

        if (c.raisedAmount >= c.goalAmount) {
            c.goalReached = true;
        }
        emit CampaignFunded(_campaignId, msg.sender, msg.value);
    }

    // ── Withdraw (creator) ───────────────────────────────────────────
    function withdrawFunds(uint256 _campaignId) external campaignExists(_campaignId) {
        Campaign storage c = campaigns[_campaignId];
        require(msg.sender == c.creator, "Not creator");
        require(c.goalReached,           "Goal not reached");
        require(!c.fundsWithdrawn,       "Already withdrawn");

        c.fundsWithdrawn = true;
        uint256 fee    = (c.raisedAmount * platformFeePercent) / 100;
        uint256 payout = c.raisedAmount - fee;

        payable(owner).transfer(fee);
        c.creator.transfer(payout);
        emit FundsWithdrawn(_campaignId, payout);
    }

    // ── Refund (backer) ──────────────────────────────────────────────
    function claimRefund(uint256 _campaignId) external campaignExists(_campaignId) {
        Campaign storage c = campaigns[_campaignId];
        require(
            block.timestamp >= c.deadline && !c.goalReached || c.isCancelled,
            "Refund not available"
        );
        uint256 amount = contributions[_campaignId][msg.sender];
        require(amount > 0, "Nothing to refund");

        contributions[_campaignId][msg.sender] = 0;
        payable(msg.sender).transfer(amount);
        emit RefundClaimed(_campaignId, msg.sender, amount);
    }

    // ── Cancel (creator) ─────────────────────────────────────────────
    function cancelCampaign(uint256 _campaignId) external campaignExists(_campaignId) {
        Campaign storage c = campaigns[_campaignId];
        require(msg.sender == c.creator, "Not creator");
        require(!c.fundsWithdrawn,       "Already withdrawn");
        c.isCancelled = true;
        emit CampaignCancelled(_campaignId);
    }

    // ── Views ────────────────────────────────────────────────────────
    function getCampaign(uint256 _id) external view campaignExists(_id) returns (Campaign memory) {
        return campaigns[_id];
    }

    function getAllCampaigns() external view returns (Campaign[] memory) {
        Campaign[] memory all = new Campaign[](campaignCount);
        for (uint256 i = 1; i <= campaignCount; i++) {
            all[i - 1] = campaigns[i];
        }
        return all;
    }

    function getContribution(uint256 _campaignId, address _backer)
        external view campaignExists(_campaignId)
        returns (uint256)
    {
        return contributions[_campaignId][_backer];
    }
}
