import hre from "hardhat";
import { Vault__factory } from "../../typechain-types/factories/contracts/Vault__factory";
import { deposit } from "../utils/helper";

async function main() {
  const { deployments, ethers } = hre;
  const { get } = deployments;
  const privateKey = process.env.DEPLOYER!;
  const wallet = new ethers.Wallet(privateKey, ethers.provider);
  let vault = Vault__factory.connect((await get("TestVault")).address);

  await deposit(await vault.getAddress(), ethers.parseUnits("2", 6), wallet);
}
main();
