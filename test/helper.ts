import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Accountant, ERC20Mintable, MockStrategy, Vault } from "../typechain-types";
import { ethers as ethersv6 } from "ethers";
import hre from "hardhat";

const { get } = hre.deployments;

export async function mintAndDeposit(vault: Vault, asset: ERC20Mintable, amount: bigint = 10n ** 6n, signer: HardhatEthersSigner | ethersv6.Wallet) {
  await asset.connect(signer).mint(signer.address, amount);
  await asset.connect(signer).approve(await vault.getAddress(), amount);
  await vault.connect(signer).deposit(amount, signer.address);
}

export async function mint(asset: ERC20Mintable, amount: bigint = 10n ** 6n, signer: HardhatEthersSigner | ethersv6.Wallet) {
  await asset.connect(signer).mint(signer.address, amount);
}

export async function setDepositLimit(vault: Vault, amount: bigint = ethersv6.MaxUint256, signer: HardhatEthersSigner | ethersv6.Wallet) {
  let tx = await vault.connect(signer).setDepositLimit(amount);
  return tx.wait();
}

export async function setDepositLimitModule(vault: Vault, signer: HardhatEthersSigner | ethersv6.Wallet) {
  let module = await get("DepositLimitModule");
  let tx = await vault.connect(signer).setDepositLimitModule(module.address);
  await tx.wait();
}

export async function addDebtToStrategy(vault: Vault, strategy: MockStrategy, amount: bigint = 10n ** 6n, signer: HardhatEthersSigner | ethersv6.Wallet) {
  let tx = await vault.connect(signer).updateMaxDebtForStrategy(await strategy.getAddress(), amount);
  await tx.wait();
  let tx2 = await vault.connect(signer).updateDebt(await strategy.getAddress(), amount, 0);
  await tx2.wait();
}

export async function addStrategy(vault: Vault, strategy: MockStrategy, signer: HardhatEthersSigner | ethersv6.Wallet) {
  let tx = await vault.connect(signer).addStrategy(await strategy.getAddress(), true);
  await tx.wait();
}

export async function updateMaxDebt(vault: Vault, strategy: MockStrategy, amount: bigint = 10n ** 6n, signer: HardhatEthersSigner | ethersv6.Wallet) {
  let tx = await vault.connect(signer).updateMaxDebtForStrategy(await strategy.getAddress(), amount);
  await tx.wait();
}

export async function updateDebt(vault: Vault, strategy: MockStrategy, amount: bigint = 10n ** 6n, signer: HardhatEthersSigner | ethersv6.Wallet, staticCall: boolean = false) {
  if (staticCall == false) {
    let tx = await vault.connect(signer).updateDebt(await strategy.getAddress(), amount, 0);
    return tx.wait();
  } else {
    let tx = await vault.connect(signer).updateDebt.staticCallResult(await strategy.getAddress(), amount, 0);
    return tx[0];
  }
}

export async function setLoss(strategy: MockStrategy, amount: bigint = 10n ** 6n, signer: HardhatEthersSigner | ethersv6.Wallet) {
  let tx = await strategy.connect(signer).setLoss(amount);
  return tx.wait();
}

export async function setLock(strategy: MockStrategy, amount: bigint = 10n ** 6n, signer: HardhatEthersSigner | ethersv6.Wallet) {
  let tx = await strategy.connect(signer).lock(amount);
  return tx.wait();
}

export async function setMaxDebt(strategy: MockStrategy, amount: bigint = 10n ** 6n, signer: HardhatEthersSigner | ethersv6.Wallet) {
  let tx = await strategy.connect(signer).setMaxDebt(amount);
  return tx.wait();
}

export async function setMinimumTotalIdle(vault: Vault, amount: bigint = 10n ** 6n, signer: HardhatEthersSigner | ethersv6.Wallet) {
  let tx = await vault.connect(signer).setMinimumTotalIdle(amount);
  return tx.wait();
}

export async function airdropAsset(asset: ERC20Mintable, to: string, amount: bigint = 10n ** 6n, signer: HardhatEthersSigner | ethersv6.Wallet) {
  let tx = await asset.connect(signer).mint(to, amount);
  return tx.wait();
}

export async function getVaultBalance(vault: Vault, asset: ERC20Mintable): Promise<bigint> {
  return await asset.balanceOf(await vault.getAddress());
}

export async function getStrategyBalance(strategy: MockStrategy, asset: ERC20Mintable): Promise<bigint> {
  return await asset.balanceOf(await strategy.getAddress());
}

export async function processReport(vault: Vault, strategy: MockStrategy, signer: HardhatEthersSigner | ethersv6.Wallet) {
  let tx = await vault.connect(signer).processReport(await strategy.getAddress());
  return tx.wait();
}

export async function setFee(
  accountant: Accountant,
  strategy: MockStrategy,
  managementFee: bigint,
  performanceFee: bigint,
  refundRatio: bigint,
  signer: HardhatEthersSigner | ethersv6.Wallet
) {
  let tx = await accountant.connect(signer).setManagementFee(await strategy.getAddress(), managementFee);
  await tx.wait();
  let tx2 = await accountant.connect(signer).setPerformanceFee(await strategy.getAddress(), performanceFee);
  await tx2.wait();
  let tx3 = await accountant.connect(signer).setRefundRatio(await strategy.getAddress(), refundRatio);
  await tx3.wait();
}
