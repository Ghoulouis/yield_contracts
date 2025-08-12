import { parseUnits } from "ethers";
import hre from "hardhat";
import { Vault__factory } from "../../typechain-types";
import { addStrategy, ROLES, setDebt, setMaxDebt, setRole } from "../utils/helper";
import { addresses } from "../../utils/address";

async function main() {
  const { deployments, ethers } = hre;
  const { get } = deployments;
  const privateKey = process.env.DEPLOYER!;
  const wallet = new ethers.Wallet(privateKey, ethers.provider);
  let vault = Vault__factory.connect((await get("TestVault")).address);
  await setRole(await vault.getAddress(), wallet.address, ROLES.DEBT_MANAGER, wallet);
  await vault.connect(wallet).setAutoAllocate(true);
}
main();
