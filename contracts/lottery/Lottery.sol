// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title BNBLottery
 * @notice A decentralized lottery DApp on BNB Chain
 * @dev Deploy on Remix IDE | Compiler: 0.8.19+
 *      Players buy tickets with BNB, owner picks winner
 */
contract BNBLottery {

    // ─────────────────────────────────────────────
    //  STRUCTS & STATE
    // ─────────────────────────────────────────────

    struct Round {
        uint256 id;
        uint256 ticketPrice;
        uint256 prizePool;
        uint256 startTime;
        uint256 endTime;
        address winner;
        bool    isOpen;
        bool    isPaid;
        uint256 totalTickets;
    }

    address public owner;
    uint256 public roundCount;
    uint256 public ownerFeePercent = 5; // 5% platform fee

    mapping(uint256 => Round)              public rounds;
    mapping(uint256 => address[])          public roundParticipants;
    mapping(uint256 => mapping(address => uint256)) public ticketsBought;

    // ─────────────────────────────────────────────
    //  EVENTS
    // ─────────────────────────────────────────────

    event RoundCreated(uint256 indexed roundId, uint256 ticketPrice, uint256 endTime);
    event TicketPurchased(uint256 indexed roundId, address indexed player, uint256 tickets);
    event WinnerPicked(uint256 indexed roundId, address indexed winner, uint256 prize);
    event RoundClosed(uint256 indexed roundId);

    // ─────────────────────────────────────────────
    //  MODIFIERS
    // ─────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not the owner");
        _;
    }

    modifier roundExists(uint256 _roundId) {
        require(_roundId > 0 && _roundId <= roundCount, "Round does not exist");
        _;
    }

    // ─────────────────────────────────────────────
    //  CONSTRUCTOR
    // ─────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ─────────────────────────────────────────────
    //  OWNER FUNCTIONS
    // ─────────────────────────────────────────────

    /**
     * @notice Create a new lottery round
     * @param _ticketPrice Price per ticket in wei (e.g. 0.01 BNB = 10000000000000000)
     * @param _durationSeconds How long the round lasts in seconds
     */
    function createRound(uint256 _ticketPrice, uint256 _durationSeconds)
        external
        onlyOwner
    {
        require(_ticketPrice > 0,       "Ticket price must be > 0");
        require(_durationSeconds >= 60, "Duration must be at least 60 seconds");

        roundCount++;
        rounds[roundCount] = Round({
            id:           roundCount,
            ticketPrice:  _ticketPrice,
            prizePool:    0,
            startTime:    block.timestamp,
            endTime:      block.timestamp + _durationSeconds,
            winner:       address(0),
            isOpen:       true,
            isPaid:       false,
            totalTickets: 0
        });

        emit RoundCreated(roundCount, _ticketPrice, block.timestamp + _durationSeconds);
    }

    /**
     * @notice Pick a winner using pseudo-random hash (for production use Chainlink VRF)
     */
    function pickWinner(uint256 _roundId)
    external
    onlyOwner
    roundExists(_roundId)
{
    Round storage round = rounds[_roundId];
    require(round.isOpen,                        "Round already closed");
    require(block.timestamp >= round.endTime,    "Round has not ended yet");
    require(roundParticipants[_roundId].length > 0, "No participants");

    // Pseudo-random — good for testnet; use Chainlink VRF for mainnet
    uint256 randomIndex = uint256(
        keccak256(abi.encodePacked(block.timestamp, block.prevrandao, roundParticipants[_roundId].length))
    ) % roundParticipants[_roundId].length;

    address winner = roundParticipants[_roundId][randomIndex];
    uint256 fee    = (round.prizePool * ownerFeePercent) / 100;
    uint256 prize  = round.prizePool - fee;

    round.winner  = winner;
    round.isOpen  = false;
    round.isPaid  = true;

    (bool success1, ) = payable(owner).call{value: fee}("");
    (bool success2, ) = payable(winner).call{value: prize}("");

    require(success1 && success2, "Transfer failed");

    emit WinnerPicked(_roundId, winner, prize);
}

    /**
     * @notice Close a round early (refunds not included — for emergency use)
     */
    function closeRound(uint256 _roundId)
        external
        onlyOwner
        roundExists(_roundId)
    {
        rounds[_roundId].isOpen = false;
        emit RoundClosed(_roundId);
    }

    function setOwnerFee(uint256 _percent) external onlyOwner {
        require(_percent <= 20, "Fee cannot exceed 20%");
        ownerFeePercent = _percent;
    }

    // ─────────────────────────────────────────────
    //  PLAYER FUNCTIONS
    // ─────────────────────────────────────────────

    /**
     * @notice Buy one or more tickets for a lottery round
     * @param _roundId  The round to enter
     * @param _quantity Number of tickets to buy
     */
    function buyTickets(uint256 _roundId, uint256 _quantity)
        external
        payable
        roundExists(_roundId)
    {
        Round storage round = rounds[_roundId];
        require(round.isOpen,                  "Round is closed");
        require(block.timestamp < round.endTime, "Round has ended");
        require(_quantity > 0 && _quantity <= 50, "Buy between 1 and 50 tickets");
        require(msg.value == round.ticketPrice * _quantity, "Incorrect BNB sent");

        // Add address for each ticket to increase winning chance
        for (uint256 i = 0; i < _quantity; i++) {
            roundParticipants[_roundId].push(msg.sender);
        }

        if (ticketsBought[_roundId][msg.sender] == 0) {
            // first time entering this round — nothing extra needed
        }
        ticketsBought[_roundId][msg.sender] += _quantity;
        round.prizePool    += msg.value;
        round.totalTickets += _quantity;

        emit TicketPurchased(_roundId, msg.sender, _quantity);
    }

    // ─────────────────────────────────────────────
    //  VIEW FUNCTIONS
    // ─────────────────────────────────────────────

    function getRound(uint256 _roundId)
        external
        view
        roundExists(_roundId)
        returns (Round memory)
    {
        return rounds[_roundId];
    }

    function getMyTickets(uint256 _roundId, address _player)
        external
        view
        returns (uint256)
    {
        return ticketsBought[_roundId][_player];
    }

    function getParticipantCount(uint256 _roundId)
        external
        view
        returns (uint256)
    {
        return roundParticipants[_roundId].length;
    }

    function getWinChance(uint256 _roundId, address _player)
        external
        view
        roundExists(_roundId)
        returns (uint256 numerator, uint256 denominator)
    {
        uint256 total = roundParticipants[_roundId].length;
        if (total == 0) return (0, 1);
        return (ticketsBought[_roundId][_player], total);
    }

    function getTimeLeft(uint256 _roundId)
        external
        view
        roundExists(_roundId)
        returns (uint256)
    {
        if (block.timestamp >= rounds[_roundId].endTime) return 0;
        return rounds[_roundId].endTime - block.timestamp;
    }
}
