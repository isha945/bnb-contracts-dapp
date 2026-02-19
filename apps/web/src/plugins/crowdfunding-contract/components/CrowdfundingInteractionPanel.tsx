'use client';

import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import {
  Heart,
  Users,
  RefreshCw,
  Loader2,
  AlertCircle,
  Check,
  ExternalLink,
  Timer,
  TrendingUp,
  Plus,
  ChevronDown,
  XCircle,
  ArrowDownCircle,
} from 'lucide-react';
import { useAccount } from 'wagmi';
import { cn } from './cn';

import { BNB_NETWORKS, type BnbNetworkKey } from '../../../../lib/bnb-network-config';
import CROWDFUNDING_ABI from '../contract/crowdfunding/crowdfunding-abi.json';

export interface CrowdfundingInteractionPanelProps {
  contractAddress?: string;
}

interface CampaignData {
  id: number;
  creator: string;
  title: string;
  description: string;
  imageUrl: string;
  goalAmount: bigint;
  raisedAmount: bigint;
  deadline: bigint;
  goalReached: boolean;
  fundsWithdrawn: boolean;
  isCancelled: boolean;
  backerCount: bigint;
}

interface TxStatus {
  status: 'idle' | 'pending' | 'success' | 'error';
  message: string;
  hash?: string;
}

export function CrowdfundingInteractionPanel({
  contractAddress: initialAddress,
}: CrowdfundingInteractionPanelProps) {
  const defaultAddress = initialAddress ?? '0x96bBBef124fe87477244D8583F771fdF6C2f0ED6';
  const [contractAddress] = useState(defaultAddress);
  const [selectedNetwork, setSelectedNetwork] = useState<BnbNetworkKey>('testnet');
  const [showNetworkDropdown, setShowNetworkDropdown] = useState(false);
  const networkConfig = BNB_NETWORKS[selectedNetwork];

  const { address: userAddress, isConnected: walletConnected, chain } = useAccount();

  // Campaign state
  const [campaignCount, setCampaignCount] = useState<number>(0);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);
  const [campaignData, setCampaignData] = useState<CampaignData | null>(null);
  const [myContribution, setMyContribution] = useState<bigint | null>(null);

  // Fund amount
  const [fundAmount, setFundAmount] = useState('0.01');

  // Create campaign state
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newImageUrl, setNewImageUrl] = useState('');
  const [newGoalAmount, setNewGoalAmount] = useState('1');
  const [newDurationDays, setNewDurationDays] = useState('30');
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Tx status
  const [txStatus, setTxStatus] = useState<TxStatus>({ status: 'idle', message: '' });
  const [contractError, setContractError] = useState<string | null>(null);

  const explorerUrl = `${networkConfig.explorerUrl}/address/${contractAddress}`;

  const getReadContract = useCallback(() => {
    if (!contractAddress) return null;
    const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
    return new ethers.Contract(contractAddress, CROWDFUNDING_ABI, provider);
  }, [contractAddress, networkConfig.rpcUrl]);

  const getWriteContract = useCallback(async () => {
    if (!contractAddress) throw new Error('No contract address specified');
    if (!walletConnected) throw new Error('Please connect your wallet first');

    const ethereum = (window as any).ethereum;
    if (!ethereum) throw new Error('No wallet detected. Please install MetaMask or a compatible wallet.');

    const targetChainIdHex = `0x${networkConfig.chainId.toString(16)}`;

    if (chain?.id !== networkConfig.chainId) {
      try {
        await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: targetChainIdHex }] });
      } catch (switchError: any) {
        if (switchError.code === 4902) {
          await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{ chainId: targetChainIdHex, chainName: networkConfig.name, rpcUrls: [networkConfig.rpcUrl], nativeCurrency: networkConfig.nativeCurrency, blockExplorerUrls: [networkConfig.explorerUrl] }],
          });
        } else {
          throw switchError;
        }
      }
    }

    const provider = new ethers.BrowserProvider(ethereum);
    const signer = await provider.getSigner();
    return new ethers.Contract(contractAddress, CROWDFUNDING_ABI, signer);
  }, [contractAddress, walletConnected, chain?.id, networkConfig]);

  // Fetch campaign count
  const fetchCampaignCount = useCallback(async () => {
    try {
      const contract = getReadContract();
      if (!contract) return;
      const count = await contract.campaignCount();
      const countNum = Number(count);
      setCampaignCount(countNum);
      if (countNum > 0 && selectedCampaignId === null) {
        setSelectedCampaignId(countNum);
      }
      setContractError(null);
    } catch (err: any) {
      setContractError(err.message || 'Failed to fetch campaign count');
    }
  }, [getReadContract, selectedCampaignId]);

  // Fetch campaign data
  const fetchCampaignData = useCallback(async () => {
    if (selectedCampaignId === null || selectedCampaignId < 1) return;
    try {
      const contract = getReadContract();
      if (!contract) return;

      const c = await contract.getCampaign(selectedCampaignId);
      setCampaignData({
        id: Number(c.id),
        creator: c.creator,
        title: c.title,
        description: c.description,
        imageUrl: c.imageUrl,
        goalAmount: c.goalAmount,
        raisedAmount: c.raisedAmount,
        deadline: c.deadline,
        goalReached: c.goalReached,
        fundsWithdrawn: c.fundsWithdrawn,
        isCancelled: c.isCancelled,
        backerCount: c.backerCount,
      });

      if (userAddress) {
        const contrib = await contract.getContribution(selectedCampaignId, userAddress);
        setMyContribution(contrib);
      }

      setContractError(null);
    } catch (err: any) {
      setContractError(err.message || 'Failed to fetch campaign data');
    }
  }, [selectedCampaignId, getReadContract, userAddress]);

  useEffect(() => { fetchCampaignCount(); }, [fetchCampaignCount]);
  useEffect(() => { fetchCampaignData(); }, [fetchCampaignData]);

  // Auto-refresh
  useEffect(() => {
    const iv = setInterval(() => { fetchCampaignCount(); fetchCampaignData(); }, 15000);
    return () => clearInterval(iv);
  }, [fetchCampaignCount, fetchCampaignData]);

  // ── Actions ───────────────────────────────────────────────────────
  const handleFundCampaign = async () => {
    try {
      if (selectedCampaignId === null) return;
      setTxStatus({ status: 'pending', message: 'Funding campaign…' });
      const contract = await getWriteContract();
      const value = ethers.parseEther(fundAmount);
      const tx = await contract.fundCampaign(selectedCampaignId, { value });
      setTxStatus({ status: 'pending', message: 'Waiting for confirmation…', hash: tx.hash });
      await tx.wait();
      setTxStatus({ status: 'success', message: 'Campaign funded!', hash: tx.hash });
      fetchCampaignData();
    } catch (err: any) {
      setTxStatus({ status: 'error', message: err.reason || err.message || 'Transaction failed' });
    }
  };

  const handleCreateCampaign = async () => {
    try {
      setTxStatus({ status: 'pending', message: 'Creating campaign…' });
      const contract = await getWriteContract();
      const goalWei = ethers.parseEther(newGoalAmount);
      const tx = await contract.createCampaign(newTitle, newDescription, newImageUrl, goalWei, BigInt(newDurationDays));
      setTxStatus({ status: 'pending', message: 'Waiting for confirmation…', hash: tx.hash });
      await tx.wait();
      setTxStatus({ status: 'success', message: 'Campaign created!', hash: tx.hash });
      setShowCreateForm(false);
      setNewTitle(''); setNewDescription(''); setNewImageUrl(''); setNewGoalAmount('1'); setNewDurationDays('30');
      fetchCampaignCount();
    } catch (err: any) {
      setTxStatus({ status: 'error', message: err.reason || err.message || 'Transaction failed' });
    }
  };

  const handleWithdrawFunds = async () => {
    try {
      if (selectedCampaignId === null) return;
      setTxStatus({ status: 'pending', message: 'Withdrawing funds…' });
      const contract = await getWriteContract();
      const tx = await contract.withdrawFunds(selectedCampaignId);
      setTxStatus({ status: 'pending', message: 'Waiting for confirmation…', hash: tx.hash });
      await tx.wait();
      setTxStatus({ status: 'success', message: 'Funds withdrawn!', hash: tx.hash });
      fetchCampaignData();
    } catch (err: any) {
      setTxStatus({ status: 'error', message: err.reason || err.message || 'Transaction failed' });
    }
  };

  const handleClaimRefund = async () => {
    try {
      if (selectedCampaignId === null) return;
      setTxStatus({ status: 'pending', message: 'Claiming refund…' });
      const contract = await getWriteContract();
      const tx = await contract.claimRefund(selectedCampaignId);
      setTxStatus({ status: 'pending', message: 'Waiting for confirmation…', hash: tx.hash });
      await tx.wait();
      setTxStatus({ status: 'success', message: 'Refund claimed!', hash: tx.hash });
      fetchCampaignData();
    } catch (err: any) {
      setTxStatus({ status: 'error', message: err.reason || err.message || 'Transaction failed' });
    }
  };

  const handleCancelCampaign = async () => {
    try {
      if (selectedCampaignId === null) return;
      setTxStatus({ status: 'pending', message: 'Cancelling campaign…' });
      const contract = await getWriteContract();
      const tx = await contract.cancelCampaign(selectedCampaignId);
      setTxStatus({ status: 'pending', message: 'Waiting for confirmation…', hash: tx.hash });
      await tx.wait();
      setTxStatus({ status: 'success', message: 'Campaign cancelled!', hash: tx.hash });
      fetchCampaignData();
    } catch (err: any) {
      setTxStatus({ status: 'error', message: err.reason || err.message || 'Transaction failed' });
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────
  const isExpired = campaignData ? Number(campaignData.deadline) * 1000 < Date.now() : false;
  const progress = campaignData ? Number(campaignData.raisedAmount) * 100 / Number(campaignData.goalAmount) : 0;
  const isCreator = campaignData && userAddress ? campaignData.creator.toLowerCase() === userAddress.toLowerCase() : false;

  const formatTimeLeft = (deadline: bigint) => {
    const ms = Number(deadline) * 1000 - Date.now();
    if (ms <= 0) return 'Expired';
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    if (d > 0) return `${d}d ${h}h left`;
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m left`;
  };

  return (
    <div className="space-y-3 text-sm">
      {/* Network selector */}
      <div className="relative">
        <button
          onClick={() => setShowNetworkDropdown(!showNetworkDropdown)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[hsl(var(--color-bg-default))] border border-[hsl(var(--color-border-default))] text-xs hover:border-accent-cyan/40 transition-all"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">🟡</span>
            <span className="text-[hsl(var(--color-text-default))]">{networkConfig.name}</span>
          </div>
          <ChevronDown className={cn('w-3 h-3 text-[hsl(var(--color-text-dim))] transition-transform', showNetworkDropdown && 'rotate-180')} />
        </button>
        {showNetworkDropdown && (
          <div className="absolute z-50 w-full mt-1 py-1 rounded-lg bg-[hsl(var(--color-bg-elevated))] border border-[hsl(var(--color-border-default))] shadow-xl">
            {Object.entries(BNB_NETWORKS).map(([key, net]) => (
              <button
                key={key}
                onClick={() => { setSelectedNetwork(key as BnbNetworkKey); setShowNetworkDropdown(false); }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[hsl(var(--color-bg-hover))]',
                  selectedNetwork === key && 'bg-accent-cyan/10 text-accent-cyan'
                )}
              >
                <span className="text-sm">🟡</span>
                {net.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Explorer link */}
      <a href={explorerUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[10px] text-accent-cyan/60 hover:text-accent-cyan transition-colors">
        <ExternalLink className="w-3 h-3" /> View on {networkConfig.name} Explorer
      </a>

      {/* Contract error */}
      {contractError && (
        <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[10px] text-red-400 flex items-start gap-2">
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
          <span className="break-all">{contractError}</span>
        </div>
      )}

      {/* Campaign selector */}
      <div className="p-3 rounded-lg bg-[hsl(var(--color-bg-muted))] border border-[hsl(var(--color-border-default))]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-text-dim))] font-medium">Campaign #{selectedCampaignId ?? '—'}</span>
          <button onClick={() => { fetchCampaignCount(); fetchCampaignData(); }} className="p-1 rounded hover:bg-[hsl(var(--color-bg-hover))] text-[hsl(var(--color-text-dim))] hover:text-accent-cyan transition-colors">
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSelectedCampaignId((prev) => Math.max(1, (prev ?? 1) - 1))}
            disabled={!selectedCampaignId || selectedCampaignId <= 1}
            className="px-2 py-1 rounded bg-[hsl(var(--color-bg-default))] border border-[hsl(var(--color-border-default))] text-[10px] disabled:opacity-30 hover:border-accent-cyan/40 transition-all"
          >
            ◀
          </button>
          <span className="flex-1 text-center text-xs font-mono text-[hsl(var(--color-text-default))]">{selectedCampaignId ?? '—'} / {campaignCount}</span>
          <button
            onClick={() => setSelectedCampaignId((prev) => Math.min(campaignCount, (prev ?? 0) + 1))}
            disabled={!selectedCampaignId || selectedCampaignId >= campaignCount}
            className="px-2 py-1 rounded bg-[hsl(var(--color-bg-default))] border border-[hsl(var(--color-border-default))] text-[10px] disabled:opacity-30 hover:border-accent-cyan/40 transition-all"
          >
            ▶
          </button>
        </div>
      </div>

      {/* Campaign details */}
      {campaignData && (
        <div className="space-y-3">
          {/* Title & Status */}
          <div className="p-3 rounded-lg bg-[hsl(var(--color-bg-muted))] border border-[hsl(var(--color-border-default))]">
            <h4 className="text-sm font-semibold text-[hsl(var(--color-text-default))] mb-1">{campaignData.title}</h4>
            <p className="text-[10px] text-[hsl(var(--color-text-dim))] mb-2 line-clamp-2">{campaignData.description}</p>
            <div className="flex gap-2 flex-wrap">
              {campaignData.isCancelled && <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-red-500/15 text-red-400">Cancelled</span>}
              {campaignData.goalReached && <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-green-500/15 text-green-400">Goal Reached</span>}
              {campaignData.fundsWithdrawn && <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-blue-500/15 text-blue-400">Withdrawn</span>}
              {isExpired && !campaignData.isCancelled && <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-orange-500/15 text-orange-400">Expired</span>}
              {!isExpired && !campaignData.isCancelled && <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-accent-cyan/15 text-accent-cyan">{formatTimeLeft(campaignData.deadline)}</span>}
            </div>
          </div>

          {/* Progress */}
          <div className="p-3 rounded-lg bg-[hsl(var(--color-bg-muted))] border border-[hsl(var(--color-border-default))]">
            <div className="flex justify-between text-[10px] text-[hsl(var(--color-text-dim))] mb-1">
              <span>Progress</span>
              <span>{progress.toFixed(1)}%</span>
            </div>
            <div className="h-2 rounded-full bg-[hsl(var(--color-bg-default))] overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-accent-cyan to-green-400 transition-all" style={{ width: `${Math.min(100, progress)}%` }} />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] text-[hsl(var(--color-text-dim))]">Raised: {ethers.formatEther(campaignData.raisedAmount)} BNB</span>
              <span className="text-[10px] text-[hsl(var(--color-text-dim))]">Goal: {ethers.formatEther(campaignData.goalAmount)} BNB</span>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 rounded-lg bg-[hsl(var(--color-bg-muted))] border border-[hsl(var(--color-border-default))] text-center">
              <Users className="w-3 h-3 mx-auto mb-1 text-accent-cyan/60" />
              <div className="text-xs font-mono text-[hsl(var(--color-text-default))]">{Number(campaignData.backerCount)}</div>
              <div className="text-[9px] text-[hsl(var(--color-text-dim))]">Backers</div>
            </div>
            <div className="p-2 rounded-lg bg-[hsl(var(--color-bg-muted))] border border-[hsl(var(--color-border-default))] text-center">
              <Heart className="w-3 h-3 mx-auto mb-1 text-accent-cyan/60" />
              <div className="text-xs font-mono text-[hsl(var(--color-text-default))]">{myContribution ? ethers.formatEther(myContribution) : '0'}</div>
              <div className="text-[9px] text-[hsl(var(--color-text-dim))]">My Contribution</div>
            </div>
          </div>

          {/* Fund campaign */}
          {!campaignData.isCancelled && !isExpired && !campaignData.fundsWithdrawn && (
            <div className="p-3 rounded-lg bg-accent-cyan/5 border border-accent-cyan/20">
              <label className="block text-[10px] uppercase tracking-wider text-accent-cyan/60 font-medium mb-1.5">Fund this Campaign</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={fundAmount}
                  onChange={(e) => setFundAmount(e.target.value)}
                  className="flex-1 bg-[hsl(var(--color-bg-default))] border border-[hsl(var(--color-border-default))] rounded px-2 py-1.5 text-xs font-mono text-[hsl(var(--color-text-default))] focus:outline-none focus:ring-1 focus:ring-accent-cyan/50"
                />
                <button
                  onClick={handleFundCampaign}
                  disabled={!walletConnected || txStatus.status === 'pending'}
                  className={cn(
                    'px-3 py-1.5 rounded text-xs font-medium transition-all',
                    walletConnected ? 'bg-accent-cyan text-black hover:bg-accent-cyan/80' : 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  )}
                >
                  {txStatus.status === 'pending' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Fund'}
                </button>
              </div>
            </div>
          )}

          {/* Creator actions */}
          {isCreator && (
            <div className="space-y-2">
              {campaignData.goalReached && !campaignData.fundsWithdrawn && (
                <button onClick={handleWithdrawFunds} disabled={txStatus.status === 'pending'} className="w-full px-3 py-2 rounded-lg text-xs font-medium bg-green-500/15 text-green-400 hover:bg-green-500/25 border border-green-500/20 transition-all">
                  <ArrowDownCircle className="w-3 h-3 inline mr-1.5" /> Withdraw Funds
                </button>
              )}
              {!campaignData.fundsWithdrawn && !campaignData.isCancelled && (
                <button onClick={handleCancelCampaign} disabled={txStatus.status === 'pending'} className="w-full px-3 py-2 rounded-lg text-xs font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20 transition-all">
                  <XCircle className="w-3 h-3 inline mr-1.5" /> Cancel Campaign
                </button>
              )}
            </div>
          )}

          {/* Refund for backers */}
          {!isCreator && (myContribution ?? 0n) > 0n && (isExpired && !campaignData.goalReached || campaignData.isCancelled) && (
            <button onClick={handleClaimRefund} disabled={txStatus.status === 'pending'} className="w-full px-3 py-2 rounded-lg text-xs font-medium bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 border border-orange-500/20 transition-all">
              Claim Refund
            </button>
          )}
        </div>
      )}

      {/* Create campaign */}
      <div className="border-t border-[hsl(var(--color-border-default))] pt-3">
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20 border border-accent-cyan/20 transition-all"
        >
          <Plus className="w-3 h-3" /> Create Campaign
        </button>

        {showCreateForm && (
          <div className="mt-3 space-y-2 p-3 rounded-lg bg-[hsl(var(--color-bg-muted))] border border-[hsl(var(--color-border-default))]">
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Campaign title" className="w-full bg-[hsl(var(--color-bg-default))] border border-[hsl(var(--color-border-default))] rounded px-2 py-1.5 text-xs text-[hsl(var(--color-text-default))] placeholder-[hsl(var(--color-text-dim))] focus:outline-none focus:ring-1 focus:ring-accent-cyan/50" />
            <textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Description" rows={2} className="w-full bg-[hsl(var(--color-bg-default))] border border-[hsl(var(--color-border-default))] rounded px-2 py-1.5 text-xs text-[hsl(var(--color-text-default))] placeholder-[hsl(var(--color-text-dim))] focus:outline-none focus:ring-1 focus:ring-accent-cyan/50 resize-none" />
            <input value={newImageUrl} onChange={(e) => setNewImageUrl(e.target.value)} placeholder="Image URL (optional)" className="w-full bg-[hsl(var(--color-bg-default))] border border-[hsl(var(--color-border-default))] rounded px-2 py-1.5 text-xs text-[hsl(var(--color-text-default))] placeholder-[hsl(var(--color-text-dim))] focus:outline-none focus:ring-1 focus:ring-accent-cyan/50" />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[9px] text-[hsl(var(--color-text-dim))] mb-0.5">Goal (BNB)</label>
                <input type="number" min="0.01" step="0.01" value={newGoalAmount} onChange={(e) => setNewGoalAmount(e.target.value)} className="w-full bg-[hsl(var(--color-bg-default))] border border-[hsl(var(--color-border-default))] rounded px-2 py-1.5 text-xs font-mono text-[hsl(var(--color-text-default))] focus:outline-none focus:ring-1 focus:ring-accent-cyan/50" />
              </div>
              <div>
                <label className="block text-[9px] text-[hsl(var(--color-text-dim))] mb-0.5">Duration (days)</label>
                <input type="number" min="1" value={newDurationDays} onChange={(e) => setNewDurationDays(e.target.value)} className="w-full bg-[hsl(var(--color-bg-default))] border border-[hsl(var(--color-border-default))] rounded px-2 py-1.5 text-xs font-mono text-[hsl(var(--color-text-default))] focus:outline-none focus:ring-1 focus:ring-accent-cyan/50" />
              </div>
            </div>
            <button
              onClick={handleCreateCampaign}
              disabled={!walletConnected || !newTitle || txStatus.status === 'pending'}
              className={cn(
                'w-full px-3 py-2 rounded-lg text-xs font-medium transition-all',
                walletConnected && newTitle ? 'bg-accent-cyan text-black hover:bg-accent-cyan/80' : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              )}
            >
              {txStatus.status === 'pending' ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'Create Campaign'}
            </button>
          </div>
        )}
      </div>

      {/* Tx status */}
      {txStatus.status !== 'idle' && (
        <div className={cn(
          'p-2 rounded-lg text-[10px] flex items-start gap-2 border',
          txStatus.status === 'pending' && 'bg-yellow-500/10 border-yellow-500/20 text-yellow-300',
          txStatus.status === 'success' && 'bg-green-500/10 border-green-500/20 text-green-300',
          txStatus.status === 'error' && 'bg-red-500/10 border-red-500/20 text-red-300'
        )}>
          {txStatus.status === 'pending' && <Loader2 className="w-3 h-3 animate-spin shrink-0 mt-0.5" />}
          {txStatus.status === 'success' && <Check className="w-3 h-3 shrink-0 mt-0.5" />}
          {txStatus.status === 'error' && <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />}
          <div>
            <span>{txStatus.message}</span>
            {txStatus.hash && (
              <a href={`${networkConfig.explorerUrl}/tx/${txStatus.hash}`} target="_blank" rel="noreferrer" className="block mt-1 text-accent-cyan/60 hover:text-accent-cyan underline">
                View Transaction
              </a>
            )}
          </div>
        </div>
      )}

      {/* Wallet warning */}
      {!walletConnected && (
        <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-[10px] text-orange-300 flex items-center gap-2">
          <AlertCircle className="w-3 h-3 shrink-0" />
          Connect your wallet to interact with this contract
        </div>
      )}
    </div>
  );
}
