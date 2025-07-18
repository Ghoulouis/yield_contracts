import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { addresses } from "../../utils/address";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy, get } = deployments;
  const { deployer, agent } = await getNamedAccounts();

  let usdc = addresses.base.usdc;

  let timeUnlock = 7 * 24 * 60 * 60;

  await deploy("Vault", {
    contract: "Vault",
    from: deployer,
    proxy: {
      owner: deployer,
      execute: {
        init: {
          methodName: "initialize",
          args: [deployer, agent, usdc, "LP Vault", "LP", 12, timeUnlock],
        },
      },
    },
    log: true,
    autoMine: true,
  });
};
deploy.tags = ["vault"];

export default deploy;
