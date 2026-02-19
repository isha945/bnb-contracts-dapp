// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract BountyBoard {
    enum BountyStatus { Open, UnderReview, Completed, Expired, Cancelled }

    struct Bounty {
        uint256      id;
        address      poster;
        string       title;
        string       description;
        string       requirements;
        string       category;
        uint256      reward;         // in wei (BNB sent on creation)
        uint256      deadline;       // unix timestamp
        BountyStatus status;
        uint256      submissionCount;
        address      winner;
        uint256      createdAt;
    }

    struct Submission {
        address worker;
        string  solutionUrl;
        string  notes;
        uint256 submittedAt;
        bool    approved;
        bool    rejected;
    }

    address public owner;
    uint256 public bountyCount;
    uint256 public platformFeePercent = 3;   // 3 %

    mapping(uint256 => Bounty)         public bounties;
    mapping(uint256 => Submission[])   private submissions;

    // ── Events ───────────────────────────────────────────────────────
    event BountyCreated     (uint256 indexed bountyId, address indexed poster, string title, uint256 reward);
    event WorkSubmitted     (uint256 indexed bountyId, address indexed worker);
    event SubmissionApproved(uint256 indexed bountyId, address indexed worker, uint256 submissionIdx);
    event SubmissionRejected(uint256 indexed bountyId, address indexed worker, uint256 submissionIdx);
    event BountyCancelled   (uint256 indexed bountyId);
    event BountyReclaimed   (uint256 indexed bountyId, address indexed poster, uint256 amount);

    // ── Modifiers ────────────────────────────────────────────────────
    modifier onlyOwner()                 { require(msg.sender == owner, "Not owner");       _; }
    modifier bountyExists(uint256 _id)   { require(_id > 0 && _id <= bountyCount, "No bounty"); _; }

    constructor() { owner = msg.sender; }

    // ── Create bounty (poster sends reward as msg.value) ─────────────
    function createBounty(
        string memory _title,
        string memory _description,
        string memory _requirements,
        string memory _category,
        uint256       _deadlineDays
    ) external payable {
        require(bytes(_title).length > 0,  "Title required");
        require(msg.value > 0,             "Reward required");
        require(_deadlineDays > 0,         "Duration must be > 0");

        bountyCount++;
        bounties[bountyCount] = Bounty({
            id:              bountyCount,
            poster:          msg.sender,
            title:           _title,
            description:     _description,
            requirements:    _requirements,
            category:        _category,
            reward:          msg.value,
            deadline:        block.timestamp + (_deadlineDays * 1 days),
            status:          BountyStatus.Open,
            submissionCount: 0,
            winner:          address(0),
            createdAt:       block.timestamp
        });
        emit BountyCreated(bountyCount, msg.sender, _title, msg.value);
    }

    // ── Submit work (worker) ─────────────────────────────────────────
    function submitWork(
        uint256 _bountyId,
        string memory _solutionUrl,
        string memory _notes
    ) external bountyExists(_bountyId) {
        Bounty storage b = bounties[_bountyId];
        require(b.status == BountyStatus.Open, "Not open");
        require(block.timestamp < b.deadline,  "Deadline passed");
        require(msg.sender != b.poster,        "Poster can't submit");

        submissions[_bountyId].push(Submission({
            worker:      msg.sender,
            solutionUrl: _solutionUrl,
            notes:       _notes,
            submittedAt: block.timestamp,
            approved:    false,
            rejected:    false
        }));
        b.submissionCount++;
        b.status = BountyStatus.UnderReview;
        emit WorkSubmitted(_bountyId, msg.sender);
    }

    // ── Approve submission (poster) ──────────────────────────────────
    function approveSubmission(uint256 _bountyId, uint256 _submissionIdx)
        external bountyExists(_bountyId)
    {
        Bounty storage b = bounties[_bountyId];
        require(msg.sender == b.poster,                      "Not poster");
        require(b.status == BountyStatus.UnderReview,        "Not under review");
        require(_submissionIdx < submissions[_bountyId].length, "Bad index");

        Submission storage s = submissions[_bountyId][_submissionIdx];
        require(!s.approved && !s.rejected, "Already reviewed");

        s.approved = true;
        b.status   = BountyStatus.Completed;
        b.winner   = s.worker;

        // Pay worker minus platform fee
        uint256 fee    = (b.reward * platformFeePercent) / 100;
        uint256 payout = b.reward - fee;
        payable(owner).transfer(fee);
        payable(s.worker).transfer(payout);

        emit SubmissionApproved(_bountyId, s.worker, _submissionIdx);
    }

    // ── Reject submission (poster) ───────────────────────────────────
    function rejectSubmission(uint256 _bountyId, uint256 _submissionIdx)
        external bountyExists(_bountyId)
    {
        Bounty storage b = bounties[_bountyId];
        require(msg.sender == b.poster,          "Not poster");
        require(_submissionIdx < submissions[_bountyId].length, "Bad index");

        Submission storage s = submissions[_bountyId][_submissionIdx];
        require(!s.approved && !s.rejected, "Already reviewed");
        s.rejected = true;

        // If all submissions rejected, revert to Open
        bool allRejected = true;
        for (uint256 i = 0; i < submissions[_bountyId].length; i++) {
            if (!submissions[_bountyId][i].rejected) {
                allRejected = false;
                break;
            }
        }
        if (allRejected) b.status = BountyStatus.Open;

        emit SubmissionRejected(_bountyId, s.worker, _submissionIdx);
    }

    // ── Cancel (poster, only if Open) ────────────────────────────────
    function cancelBounty(uint256 _bountyId) external bountyExists(_bountyId) {
        Bounty storage b = bounties[_bountyId];
        require(msg.sender == b.poster, "Not poster");
        require(b.status == BountyStatus.Open, "Not open");

        b.status = BountyStatus.Cancelled;
        payable(b.poster).transfer(b.reward);
        emit BountyCancelled(_bountyId);
    }

    // ── Reclaim expired (poster) ─────────────────────────────────────
    function reclaimExpiredBounty(uint256 _bountyId) external bountyExists(_bountyId) {
        Bounty storage b = bounties[_bountyId];
        require(msg.sender == b.poster,       "Not poster");
        require(block.timestamp >= b.deadline, "Not expired");
        require(b.status == BountyStatus.Open || b.status == BountyStatus.UnderReview, "Cannot reclaim");

        b.status = BountyStatus.Expired;
        payable(b.poster).transfer(b.reward);
        emit BountyReclaimed(_bountyId, b.poster, b.reward);
    }

    // ── Views ────────────────────────────────────────────────────────
    function getBounty(uint256 _id) external view bountyExists(_id) returns (Bounty memory) {
        return bounties[_id];
    }

    function getSubmissions(uint256 _bountyId) external view returns (Submission[] memory) {
        return submissions[_bountyId];
    }

    function getAllBounties(uint256 _bountyId) external view returns (Bounty[] memory) {
        Bounty[] memory all = new Bounty[](bountyCount);
        for (uint256 i = 1; i <= bountyCount; i++) {
            all[i - 1] = bounties[i];
        }
        return all;
    }
}
