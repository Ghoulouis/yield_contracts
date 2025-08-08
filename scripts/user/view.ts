import hre from "hardhat";

import { deposit, viewApy, viewTvl } from "../utils/helper";
import { Vault__factory } from "../../typechain-types";

async function main() {
  const { deployments, ethers } = hre;
  const { get } = deployments;
  const privateKey = process.env.DEPLOYER!;
  const wallet = new ethers.Wallet(privateKey, ethers.provider);
  let vault = Vault__factory.connect((await get("TestVault")).address, ethers.provider);

  let tvl = await viewTvl(vault);
  console.log("Tvl: ", tvl);

  let apy = await viewApy(vault);
  console.log("Apy: ", apy);

  let balance = await vault.balanceOf(wallet.address);
  let balanceAsset = await vault.convertToAssets(balance);

  console.log("Balance: ", balance);
  console.log("Balance Asset: ", balanceAsset);

  let data = await vault.vaultData();
  console.table(data);
}
main();
