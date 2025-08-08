import { ethers } from "ethers";
import { ERC20__factory, Vault, Vault__factory } from "../../typechain-types";

export const ROLES = {
  GOVERNANCE_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_GOVERNANCE_MANAGER")),
  ADD_STRATEGY_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_ADD_STRATEGY_MANAGER")),
  REVOKE_STRATEGY_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_REVOKE_STRATEGY_MANAGER")),
  ACCOUNTANT_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_ACCOUNTANT_MANAGER")),
  QUEUE_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_ACCOUNTANT_MANAGER")),
  REPORTING_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_REPORTING_MANAGER")),
  DEBT_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_DEBT_MANAGER")),
  MAX_DEBT_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_MAX_DEBT_MANAGER")),
  DEPOSIT_LIMIT_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_DEPOSIT_LIMIT_MANAGER")),
  WITHDRAW_LIMIT_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_WITHDRAW_LIMIT_MANAGER")),
  MINIMUM_IDLE_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_MINIMUM_IDLE_MANAGER")),
  PROFIT_UNLOCK_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_PROFIT_UNLOCK_MANAGER")),
  DEBT_PURCHASER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_DEBT_PURCHASER")),
  EMERGENCY_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_EMERGENCY_MANAGER")),
};

async function setAllocate(address: string, status: boolean, signer: ethers.Signer) {
  const contract = Vault__factory.connect(address, signer);
}

export async function deposit(address: string, amount: bigint, signer: ethers.Signer) {
  const vault = Vault__factory.connect(address, signer);
  const assetAddress = await vault.asset();
  const asset = ERC20__factory.connect(assetAddress, signer);
  let balance = await asset.balanceOf(signer.getAddress());
  if (balance < amount) {
    throw new Error("Insufficient balance");
  }
  let preBefore = await vault.convertToAssets(await vault.balanceOf(signer.getAddress()));
  console.log("Balance in vault before: ", preBefore);
  console.log("Appoving...");
  let tx = await asset.approve(await vault.getAddress(), amount);
  let receipt = await tx.wait();
  console.log(`Approved tx: ${receipt!.hash}`);
  console.log("Depositing...");
  let tx2 = await vault.deposit(amount, signer.getAddress());
  let receipt2 = await tx2.wait();
  console.log(`Deposited tx: ${receipt2!.hash}`);
  let postAfter = await vault.convertToAssets(await vault.balanceOf(signer.getAddress()));
  console.log("Balance in vault after: ", postAfter);
}

export async function addStrategy(address: string, strategy: string, signer: ethers.Signer) {
  const vault = Vault__factory.connect(address, signer);
  let has = await vault.strategies(strategy);
  if (has.activation) {
    console.log("Strategy already added");
    return;
  }
  const tx = await vault.addStrategy(strategy, true);
  let receipt = await tx.wait();
  console.log(`Added strategy tx: ${receipt!.hash}`);
}

export async function setRole(vaultAddress: string, receiver: string, role: string, signer: ethers.Signer) {
  const vault = Vault__factory.connect(vaultAddress, signer);
  let hasRoleGov = await vault.hasRole(ROLES.GOVERNANCE_MANAGER, receiver);
  let hasRole = await vault.hasRole(role, receiver);
  if (hasRole) {
    console.log("receiver has role ");
    return;
  }
  if (!hasRoleGov) {
    throw Error("Signer hasn't GOV role");
  }
  let tx = await vault.grantRole(role, receiver);
  let receipt = await tx.wait();
  console.log(`Set role tx: ${receipt!.hash}`);
}

export async function setMaxDebt(vaultAddress: string, strategy: string, amount: bigint, signer: ethers.Signer) {
  const vault = Vault__factory.connect(vaultAddress, signer);
  let tx = await vault.updateMaxDebtForStrategy(strategy, amount);
  let receipt = await tx.wait();
  console.log(`Set max debt tx: ${receipt!.hash}`);
}

export async function setDebt(vaultAddress: string, strategy: string, amount: bigint, signer: ethers.Signer) {
  const vault = Vault__factory.connect(vaultAddress, signer);
  let tx = await vault.updateDebt(strategy, amount, 0);
  let receipt = await tx.wait();
  console.log(`Set debt tx: ${receipt!.hash}`);
}

export async function viewTvl(vault: Vault) {
  let data = await vault.vaultData();
  return data.totalDebt + data.totalIdle;
}

export async function viewApy(vault: Vault) {
  let data = await vault.vaultData();
  console.log("rate ", data.profitUnlockingRate);
  let sharesRewards = (data.profitUnlockingRate * 60n * 60n * 24n * 365n) / 1_000_000_000_000n;

  let assetReward = await vault.convertToAssets(sharesRewards);

  console.log("shareReward: ", sharesRewards);
  console.log("assetReward: ", assetReward);

  let tvl = data.totalDebt + data.totalIdle;

  let apy = (assetReward * 10_000n) / tvl;

  return (Number(apy) / 10_000) * 100;
}
