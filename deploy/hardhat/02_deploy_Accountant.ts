import { addresses } from "./../../utils/address";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, get } = deployments;
  const { deployer, agent } = await getNamedAccounts();

  let vault = await get("Vault");

  let usdc = await get("USDC");

  await deploy("Accountant", {
    contract: "Accountant",
    from: deployer,
    log: true,
    autoMine: true,
    args: [usdc.address, vault.address, deployer],
  });
};
deploy.tags = ["accountant"];
export default deploy;
