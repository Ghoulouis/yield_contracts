import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ERC20Mintable, Vault } from "../typechain-types";
import { ethers as ethersv6 } from "ethers";

export async function mintAndDeposit(vault: Vault, asset: ERC20Mintable, amount: bigint = 10n ** 6n, signer: HardhatEthersSigner | ethersv6.Wallet) {
  await asset.connect(signer).mint(signer.address, amount);
  await asset.connect(signer).approve(await vault.getAddress(), amount);
  await vault.connect(signer).deposit(amount, signer.address);
}

export async function mint(asset: ERC20Mintable, amount: bigint = 10n ** 6n, signer: HardhatEthersSigner | ethersv6.Wallet) {
  await asset.connect(signer).mint(signer.address, amount);
}

export async function setDepositLimit(vault: Vault, amount: bigint = ethersv6.MaxUint256, signer: HardhatEthersSigner | ethersv6.Wallet) {
  await vault.connect(signer).setDepositLimit(amount);
}
