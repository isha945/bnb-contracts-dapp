'use client';

import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import {
  Ticket,
  Users,
  RefreshCw,
  Loader2,
  AlertCircle,
  Check,
  ExternalLink,
  Timer,
  TrendingUp,
  Trophy,
  Gift,
  ChevronDown,
} from 'lucide-react';
import { useAccount } from 'wagmi';
import { cn } from './cn';

import { BNB_NETWORKS, type BnbNetworkKey } from '../../../../lib/bnb-network-config';
import LOTTERY_ABI from '../contract/lottery/lottery-abi.json';

export interface LotteryInteractionPanelProps {
  contractAddress?: string;
}

interface TxStatus {
  status: 'idle' | 'pending' | 'success' | 'error';
  message: string;
  hash?: string;
}

export function LotteryInteractionPanel({
  contractAddress: initialAddress,
}: LotteryInteractionPanelProps) {
  const defaultAddress = initialAddress ?? '0x9bb658a999a46d149262fe74d37894ac203ca493';
  const [contractAddress] = useState(defaultAddress);
  const [selectedNetwork, setSelectedNetwork] = useState<BnbNetworkKey>('testnet');
  const [showNetworkDropdown, setShowNetworkDropdown] = useState(false);
  const networkConfig = BNB_NETWORKS[selectedNetwork];

  const { address: userAddress, isConnected: walletConnected, chain } = useAccount();

  // Lottery state
  const [latestRoundId, setLatestRoundId] = useState<number | null>(null);
  const [selectedRoundId, setSelectedRoundId] = useState<number | null>(null);
  const [ticketPrice, setTicketPrice] = useState<bigint | null>(null);
  const [prizePool, setPrizePool] = useState<bigint | null>(null);
  const [totalTickets, setTotalTickets] = useState<bigint | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<bigint | null>(null);
  const [drawn, setDrawn] = useState<boolean | null>(null);
  const [winnerAddress, setWinnerAddress] = useState<string | null>(null);
  const [paid, setPaid] = useState<boolean | null>(null);
  const [isOpen, setIsOpen] = useState<boolean | null>(null);
  const [owner, setOwner] = useState<string | null>(null);

  // My tickets
  const [myTickets, setMyTickets] = useState<bigint | null>(null);
  const [ticketQuantity, setTicketQuantity] = useState('1');
  const [checkAddress, setCheckAddress] = useState('');
  const [checkResult, setCheckResult] = useState<bigint | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  // Round creation state
  const [newTicketPrice, setNewTicketPrice] = useState('0.01');
  const [newDuration, setNewDuration] = useState('3600');

  // Tx status
  const [txStatus, setTxStatus] = useState<TxStatus>({ status: 'idle', message: '' });
  const [contractError, setContractError] = useState<string | null>(null);

  const explorerUrl = `${networkConfig.explorerUrl}/address/${contractAddress}`;

  const getReadContract = useCallback(() => {
    if (!contractAddress) return null;
    const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
    return new ethers.Contract(contractAddress, LOTTERY_ABI, provider);
  }, [contractAddress, networkConfig.rpcUrl]);

  const getWriteContract = useCallback(async () => {
    if (!contractAddress) {
      throw new Error('No contract address specified');
    }
    if (!walletConnected) {
      throw new Error('Please connect your wallet first');
    }

    const ethereum = (window as any).ethereum;
    if (!ethereum) {
      throw new Error('No wallet detected. Please install MetaMask or a compatible wallet.');
    }

    const targetChainIdHex = `0x${networkConfig.chainId.toString(16)}`;

    if (chain?.id !== networkConfig.chainId) {
      try {
        await ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: targetChainIdHex }],
        });
      } catch (switchError: any) {
        if (switchError.code === 4902 || switchError.message?.includes('Unrecognized chain')) {
          try {
            await ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: targetChainIdHex,
                  chainName: networkConfig.name,
                  nativeCurrency: {
                    name: networkConfig.symbol,
                    symbol: networkConfig.symbol,
                    decimals: 18,
                  },
                  rpcUrls: [networkConfig.rpcUrl],
                  blockExplorerUrls: [networkConfig.explorerUrl],
                },
              ],
            });
          } catch (addError: any) {
            throw new Error(`Failed to add network to wallet: ${addError.message}`);
          }
        } else if (switchError.code === 4001) {
          throw new Error('User rejected chain switch');
        } else {
          throw switchError;
        }
      }
    }

    const provider = new ethers.BrowserProvider(ethereum);
    const signer = await provider.getSigner();
    return new ethers.Contract(contractAddress, LOTTERY_ABI, signer);
  }, [chain?.id, contractAddress, walletConnected, networkConfig]);

  const fetchState = useCallback(async () => {
    const contract = getReadContract();
    if (!contract) return;

    setContractError(null);
    try {
      const [count, contractOwner] = await Promise.all([
        contract.roundCount(),
        contract.owner(),
      ]);

      const roundCount = Number(count);
      setLatestRoundId(roundCount);
      setOwner(contractOwner as string);

      const roundIdToFetch = selectedRoundId ?? roundCount;
      if (roundIdToFetch > 0) {
        const round = await contract.getRound(roundIdToFetch);

        setTicketPrice(round.ticketPrice as bigint);
        setPrizePool(round.prizePool as bigint);
        setTotalTickets(round.totalTickets as bigint);

        const now = BigInt(Math.floor(Date.now() / 1000));
        const left = round.endTime > now ? round.endTime - now : 0n;
        setSecondsLeft(left);

        setDrawn(round.winner !== ethers.ZeroAddress);
        setWinnerAddress(round.winner as string);
        setPaid(Boolean(round.isPaid));
        setIsOpen(Boolean(round.isOpen));

        if (userAddress) {
          try {
            const myCount = await contract.getMyTickets(roundIdToFetch, userAddress);
            setMyTickets(myCount as bigint);
          } catch {
            setMyTickets(null);
          }
        }
      }
    } catch (error: any) {
      console.error('Error fetching lottery state:', error);
      setContractError(error?.reason || error?.message || 'Unable to read contract state');
    }
  }, [getReadContract, userAddress, selectedRoundId]);

  useEffect(() => {
    if (contractAddress) {
      fetchState();
    }
  }, [contractAddress, fetchState]);

  useEffect(() => {
    if (drawn || secondsLeft === null || secondsLeft === 0n) return;
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev === null || prev <= 1n) return 0n;
        return prev - 1n;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [drawn, secondsLeft]);

  const handleTx = async (op: () => Promise<ethers.TransactionResponse>, successMessage: string) => {
    try {
      setTxStatus({ status: 'pending', message: 'Confirm in your wallet…' });
      const tx = await op();
      setTxStatus({ status: 'pending', message: 'Waiting for confirmation…', hash: tx.hash });
      await tx.wait();
      setTxStatus({ status: 'success', message: successMessage, hash: tx.hash });
      await fetchState();
    } catch (error: any) {
      console.error('Transaction error:', error);
      setTxStatus({ status: 'error', message: error?.reason || error?.message || 'Transaction failed' });
    } finally {
      setTimeout(() => setTxStatus({ status: 'idle', message: '' }), 6000);
    }
  };

  const handleBuyTickets = async () => {
    const roundId = selectedRoundId ?? latestRoundId;
    if (!roundId || !isOpen) return;

    const quantity = parseInt(ticketQuantity);
    try {
      const contract = await getWriteContract();
      const price = ticketPrice ?? (await contract.rounds(roundId)).ticketPrice;
      const totalValue = price * BigInt(quantity);

      await handleTx(
        () => contract.buyTickets(roundId, quantity, { value: totalValue }),
        `Purchased ${quantity} ticket(s)! 🎟️`
      );
    } catch (error: any) {
      setTxStatus({ status: 'error', message: error?.reason || error?.message || 'Failed to buy tickets' });
    }
  };

  const handlePickWinner = async () => {
    const roundId = selectedRoundId ?? latestRoundId;
    if (!roundId) return;
    try {
      const contract = await getWriteContract();
      await handleTx(() => contract.pickWinner(roundId), 'Winner picked! 🏆');
    } catch (error: any) {
      setTxStatus({ status: 'error', message: error?.message || 'Failed to pick winner' });
    }
  };

  const handleCloseRound = async () => {
    const roundId = selectedRoundId ?? latestRoundId;
    if (!roundId) return;
    try {
      const contract = await getWriteContract();
      await handleTx(() => contract.closeRound(roundId), 'Round closed! 🔒');
    } catch (error: any) {
      setTxStatus({ status: 'error', message: error?.message || 'Failed to close round' });
    }
  };

  const handleCreateRound = async () => {
    try {
      const contract = await getWriteContract();
      const priceWei = ethers.parseEther(newTicketPrice);
      const durationSec = parseInt(newDuration);
      await handleTx(
        () => contract.createRound(priceWei, durationSec),
        'New round created! 🚀'
      );
    } catch (error: any) {
      setTxStatus({ status: 'error', message: error?.message || 'Failed to create round' });
    }
  };

  const handleCheckTickets = async () => {
    const contract = getReadContract();
    const target = (checkAddress || userAddress)?.toString();
    const roundId = selectedRoundId ?? latestRoundId;
    if (!contract || !target || !roundId) return;

    try {
      setCheckError(null);
      const result = await contract.getMyTickets(roundId, target);
      setCheckResult(result as bigint);
    } catch (error: any) {
      setCheckError(error?.reason || error?.message || 'Unable to check tickets');
    }
  };

  function formatTimeLeft(secs: bigint): string {
    const total = Number(secs);
    if (total <= 0) return 'Ended';
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  const isLotteryOver = drawn || (secondsLeft !== null && secondsLeft <= 0n);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="p-3 rounded-lg border border-purple-500/30 bg-gradient-to-r from-purple-500/10 to-transparent">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Ticket className="w-4 h-4 text-purple-400" />
            <div>
              <h3 className="text-sm font-medium text-white">Lottery Portal</h3>
              <p className="text-[10px] text-forge-muted">Decentralized raffle system</p>
            </div>
          </div>
        </div>
        <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] font-mono text-purple-400 hover:underline">
          {contractAddress.slice(0, 6)}...{contractAddress.slice(-4)}
          <ExternalLink className="w-2.5 h-2.5" />
        </a>
      </div>

      {/* Network Selector */}
      <div className="space-y-1.5">
        <label className="text-xs text-forge-muted flex items-center gap-1.5">
          <span className="text-sm">🌐</span> Network
        </label>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowNetworkDropdown(!showNetworkDropdown)}
            className={cn(
              'w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm',
              'bg-forge-bg border-forge-border',
              'text-white hover:border-purple-500/50 transition-colors'
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">🟡</span>
              <span>{networkConfig.name}</span>
              {(networkConfig.id === 'testnet' || networkConfig.id === 'opbnbTestnet') && (
                <span className="text-[8px] px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded">Testnet</span>
              )}
            </div>
            <ChevronDown className={cn(
              'w-4 h-4 text-forge-muted transition-transform',
              showNetworkDropdown && 'rotate-180'
            )} />
          </button>

          {/* Dropdown Menu */}
          {showNetworkDropdown && (
            <div className="absolute top-full mt-1 w-full bg-forge-bg border border-forge-border rounded-lg shadow-xl z-50 overflow-hidden">
              {(Object.keys(BNB_NETWORKS) as BnbNetworkKey[]).map((key) => {
                const network = BNB_NETWORKS[key];
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={network.disabled}
                    onClick={() => {
                      if (!network.disabled) {
                        setSelectedNetwork(key);
                        setShowNetworkDropdown(false);
                      }
                    }}
                    className={cn(
                      'w-full px-3 py-2.5 text-left text-sm transition-colors',
                      'flex items-center justify-between',
                      network.disabled
                        ? 'opacity-50 cursor-not-allowed bg-forge-bg/80 backdrop-blur-sm'
                        : 'hover:bg-purple-500/10 cursor-pointer',
                      selectedNetwork === key && 'bg-purple-500/20'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🟡</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-white">{network.name}</span>
                          {(network.id === 'testnet' || network.id === 'opbnbTestnet') && (
                            <span className="text-[8px] px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded">Testnet</span>
                          )}
                        </div>
                        <p className="text-[10px] text-forge-muted mt-0.5">
                          {network.description}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Wallet Info */}
      <div className={cn('p-2.5 rounded-lg border', walletConnected ? 'border-green-500/30 bg-green-500/5' : 'border-purple-500/30 bg-purple-500/5')}>
        <div className="flex items-center gap-2">
          <Users className={cn('w-3.5 h-3.5', walletConnected ? 'text-green-400' : 'text-purple-400')} />
          <span className="text-[10px] text-white">
            {walletConnected ? `Connected: ${userAddress?.slice(0, 6)}...${userAddress?.slice(-4)}` : 'Wallet not connected'}
          </span>
        </div>
      </div>

      <button onClick={fetchState} className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-medium transition-colors">
        <RefreshCw className="w-3.5 h-3.5" />
        Refresh state
      </button>

      {/* Round Selection & State */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-white">Round {selectedRoundId ?? latestRoundId ?? '—'}</span>
          <div className="flex gap-1">
            <button onClick={() => setSelectedRoundId(Math.max(1, (selectedRoundId ?? latestRoundId ?? 1) - 1))} className="p-1 rounded bg-forge-bg border border-forge-border text-xs text-white">←</button>
            <button onClick={() => setSelectedRoundId(Math.min(latestRoundId ?? 1, (selectedRoundId ?? latestRoundId ?? 1) + 1))} className="p-1 rounded bg-forge-bg border border-forge-border text-xs text-white">→</button>
          </div>
        </div>

        {contractError && <p className="text-[10px] text-red-400">{contractError}</p>}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded-lg bg-forge-bg border border-forge-border">
            <p className="text-[9px] text-forge-muted uppercase">Price</p>
            <p className="text-xs font-semibold text-white">{ticketPrice ? `${ethers.formatEther(ticketPrice)} BNB` : '—'}</p>
          </div>
          <div className="p-2 rounded-lg bg-forge-bg border border-forge-border">
            <p className="text-[9px] text-forge-muted uppercase">Pool</p>
            <p className="text-xs font-semibold text-white">{prizePool ? `${ethers.formatEther(prizePool)} BNB` : '—'}</p>
          </div>
          <div className="p-2 rounded-lg bg-forge-bg border border-forge-border">
            <p className="text-[9px] text-forge-muted uppercase">Time</p>
            <p className="text-xs font-semibold text-white">{isOpen ? (secondsLeft ? formatTimeLeft(secondsLeft) : '...') : 'Closed'}</p>
          </div>
        </div>

        <div className="p-2.5 rounded-lg bg-forge-bg border border-forge-border">
          <p className="text-[10px] text-forge-muted">Winner: <span className="text-white font-mono">{winnerAddress && winnerAddress !== ethers.ZeroAddress ? winnerAddress : 'None'}</span></p>
          <p className="text-[10px] text-forge-muted mt-1">Status: <span className="text-purple-400 font-medium">
            {isOpen ? 'Active' : (winnerAddress !== ethers.ZeroAddress ? (paid ? 'Winner Paid' : 'Winner Picked') : 'Closed')}
          </span></p>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-4">
        <div className="p-3 rounded-lg bg-forge-bg border border-forge-border space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-white">Buy Tickets</span>
            <input type="number" min="1" value={ticketQuantity} onChange={(e) => setTicketQuantity(e.target.value)} className="w-12 h-6 px-1.5 bg-forge-bg border border-forge-border rounded text-xs text-white" />
          </div>
          <button onClick={handleBuyTickets} disabled={!isOpen} className="w-full py-2 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs font-medium disabled:opacity-50">🎟️ Buy Tickets</button>
        </div>

        {/* Admin Section */}
        <div className="p-3 rounded-lg border border-purple-500/20 bg-purple-500/5 space-y-3">
          <p className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">Owner Dashboard</p>
          <div className="grid grid-cols-2 gap-2">
            <input type="text" value={newTicketPrice} onChange={(e) => setNewTicketPrice(e.target.value)} placeholder="0.01 BNB" className="h-7 px-2 bg-forge-bg border border-forge-border rounded text-[10px] text-white" />
            <input type="text" value={newDuration} onChange={(e) => setNewDuration(e.target.value)} placeholder="3600 sec" className="h-7 px-2 bg-forge-bg border border-forge-border rounded text-[10px] text-white" />
          </div>
          <button onClick={handleCreateRound} className="w-full py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded text-[10px]">🚀 Start New Round</button>

          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-forge-border/30">
            <button onClick={handleCloseRound} disabled={!isOpen} className="py-1.5 bg-forge-bg border border-forge-border text-white rounded text-[10px]">🔒 Close</button>
            <button onClick={handlePickWinner} disabled={isOpen ?? true} className="py-1.5 bg-purple-700 hover:bg-purple-600 text-white rounded text-[10px]">🎲 Pick Winner</button>
          </div>
        </div>
      </div>

      {/* Transaction Feed */}
      {txStatus.status !== 'idle' && (
        <div className={cn('p-2.5 rounded-lg border text-[10px]', txStatus.status === 'pending' ? 'bg-blue-500/10 border-blue-500/30' : txStatus.status === 'success' ? 'bg-purple-500/10 border-purple-500/30' : 'bg-red-500/10 border-red-500/30')}>
          <p className="font-medium">{txStatus.message}</p>
          {txStatus.hash && <a href={`${networkConfig.explorerUrl}/tx/${txStatus.hash}`} target="_blank" rel="noopener noreferrer" className="text-forge-muted hover:underline flex items-center gap-1 mt-1">View Transaction <ExternalLink className="w-2 h-2" /></a>}
        </div>
      )}
    </div>
  );
}
