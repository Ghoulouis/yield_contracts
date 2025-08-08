import hre from "hardhat";

import { deposit } from "../utils/helper";
import { Vault__factory } from "../../typechain-types";

async function main() {
  const { deployments, ethers } = hre;
  const { get } = deployments;
  const privateKey = process.env.DEPLOYER!;
  const wallet = new ethers.Wallet(privateKey, ethers.provider);
  let vault = Vault__factory.connect((await get("TestVault")).address, ethers.provider);
  let maxDeposit = await vault.maxDeposit(wallet.address);
  let reviewWithdraw = await vault["maxWithdraw(address)"](wallet.address);
  let totalSupply = await vault.totalSupply();
  let totalSupplyWithFee = await vault.totalSupplyWithFee();
  let totalAsset = await vault.totalAssets();

  console.log(` max Deposit = ${maxDeposit}`);
  console.log(` max Withdraw = ${reviewWithdraw}`);
  console.log(` total Supply = ${totalSupply}`);
  console.log(` total Supply With Fee = ${totalSupplyWithFee}`);
  console.log(` total Asset = ${totalAsset}`);

  //await deposit(await vault.getAddress(), ethers.parseUnits("2", 6), wallet);
}
main();
