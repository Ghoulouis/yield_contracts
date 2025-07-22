import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy, get } = deployments;
  const { deployer, agent } = await getNamedAccounts();

  let usdc = await get("USDC");
  let timeUnlock = 7 * 24 * 60 * 60;
  let ERC20LogicDeployment = await deploy("ERC20Logic", {
    from: deployer,
    log: true,
  });

  let ERC4626LogicDeployment = await deploy("ERC4626Logic", {
    from: deployer,
    log: true,
    libraries: {
      ERC20Logic: ERC20LogicDeployment.address,
    },
  });

  let DepositLogicDeployment = await deploy("DepositLogic", {
    from: deployer,
    log: true,
    libraries: {
      ERC20Logic: ERC20LogicDeployment.address,
      ERC4626Logic: ERC4626LogicDeployment.address,
    },
  });

  let WithdrawLogicDeployment = await deploy("WithdrawLogic", {
    from: deployer,
    log: true,
    libraries: {
      ERC20Logic: ERC20LogicDeployment.address,
      ERC4626Logic: ERC4626LogicDeployment.address,
    },
  });

  let UnlockSharesLogicDeployment = await deploy("UnlockSharesLogic", {
    from: deployer,
    log: true,
    libraries: {
      ERC20Logic: ERC20LogicDeployment.address,
    },
  });

  let InitializeLogicDeployment = await deploy("InitializeLogic", {
    from: deployer,
    log: true,
  });

  await deploy("Vault", {
    contract: "Vault",
    from: deployer,
    proxy: {
      owner: deployer,
      execute: {
        init: {
          methodName: "initialize",
          args: [usdc.address, "LP Vault", "LP", timeUnlock],
        },
      },
    },
    log: true,
    autoMine: true,
    libraries: {
      DepositLogic: DepositLogicDeployment.address,
      WithdrawLogic: WithdrawLogicDeployment.address,
      ERC20Logic: ERC20LogicDeployment.address,
      ERC4626Logic: ERC4626LogicDeployment.address,
      InitializeLogic: InitializeLogicDeployment.address,
      UnlockSharesLogic: UnlockSharesLogicDeployment.address,
    },
  });
};
deploy.tags = ["vault"];

export default deploy;
