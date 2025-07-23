import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, get } = deployments;
  const { deployer, agent } = await getNamedAccounts();

  let vault = await get("Vault");

  let usdc = await get("USDC");

  await deploy("FlexibleAccountant", {
    contract: "FlexibleAccountant",
    from: deployer,
    log: true,
    autoMine: true,
    proxy: {
      owner: deployer,
      execute: {
        init: {
          methodName: "initialize",
          args: [deployer, usdc.address],
        },
      },
    },
  });
};
deploy.tags = ["FlexibleAccountant"];
export default deploy;
