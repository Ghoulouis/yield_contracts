<h1> OmniFarming V2 Technical Paper </h1>

_A solidity forked from [Yearn V3](https://github.com/yearn/yearn-vaults-v3/blob/master/contracts/VaultV3.vy)_

- [Mechanism](#mechanism)

  - [Reward Mechanism](#reward-mechanism)
  - [Fee Mechanism](#fee-mechanism)

- [Function](#function)
  - [Deposit](#deposit)
  - [Withdraw](#withdraw)
  - [Report](#report)

# mechanism

### Reward Mechanism

Cơ chế trả phần trưởng trong OmniFarming V2 khá đặc biệt, 1 strategy khi tích hợp có thể mang lại lãi hoặc lỗ tuỳ thời điểm được báo cáo.

- Trường hợp lãi, lãi sẽ được vesting dần thông qua đường cong dựa trên `profitMaxUnlockTime` theo đơn vị giây

- Trường hợp lỗ, vault sẽ cập nhật tổn thất ngay lập tức, trước tiên là giảm lợi nhuận đang vesting từ báo cáo trước đó, sau đó là giảm pps.

### Fee Mechanism

OmniFarming V2 thu 2 loại phí, bao gồm:

- Management Fee: 1% 1 năm trên fund
- Performance Fee: 10% trên profit

**Management Fee**

Mint lượng lp tương ứng giữa 2 lần deposit/withdraw dựa trên số `totalSupply()`,
Override các hàm `PreviewMint` `PreviewWithdraw` `PreviewDeposit` `PreviewRedeem` theo công thức mới có tính trước management Fee vào totalSupply

**Performance Fee**

Thu phí thông qua `Accountant` trong hàm `ExecuteProcessReport`

Khi một strategy được báo cáo, `Accountant` sẽ tính `performanceFee` và `refund`

- `PerformanceFee`: Fee thu dựa trên lợi nhuận (yêu cầu business 10%), fee này sẽ được chuyển đổi thành lượng liquidity và mint chúng dưới dạng thanh khoản cho `Accountant`

- `refund`: (Forked yearn v3) giá trị trả lại mỗi khi 1 strategy được báo cáo (có thể sử dụng để làm reward boost apy hoặc bù lỗ)

# Function

### Deposit

#### Yêu cầu chức năng

- Người dùng gửi tài sản và nhận lạ lp tương ứng
- Nếu cơ chế tự động phân bổ vào strategy đầu tiên được bật thì tài sản sẽ tự động phân bổ vào strategy đầu tiên

#### Luồng hoạt động

Đầu tiên, kiểm tra 1 số điều kiện và sau đó lấy tài sản từ người gọi, và mint trả lại lp tương ứng

```solidity
require(assets <= vault.maxDeposit(receiver), "Exceed deposit limit");
require(shares > 0, "Cannot mint zero");
IERC20(vault.asset()).safeTransferFrom(
        caller,
        vault.addressVault,
        assets
    );
    vault.totalIdle += assets;
    vault._mint(receiver, shares);
```

Sau đó, nếu cơ chế tự động phân bổ được bật, tài sản sẽ được chuyển đến strategy đầu tiên thông qua việc cập nhật nợ cho stragety đầu tiên

```solidity
if (vault.autoAllocate && vault.defaultQueue.length > 0) {
        vault.ExecuteUpdateDebt(
            vault.defaultQueue[0],
            type(uint256).max,
            0
        );
    }
```

### Withdraw

# Withdraw

### Yêu cầu chức năng

- Người dùng rút tài sản bằng cách burn lượng lp tương ứng
- Kho tiền ưu tiên lượng tài sản rảnh rỗi trong vault, nếu không đủ sẽ rút phần thiếu từ các strategy
- Khi rút tiền sớm từ strategy sẽ có khả năng lỗ ( do strategy có thể lỗ), vì thế người dùng có thể nhập 1 giá trị `loss` hoạt động tương tự như slippage có thể châp nhận số tiền lỗ trong khả năng cho phép
- Cho phép B rút tiền từ lp của A nếu đã được approve lượng lp

### Luồng hoạt động

Đầu tiên kiểm tra điều kiện input và kiểm tra xem có thoả mãn nếu có cài đặt withdrawLimitModule

```solidity
        require(receiver != address(0), "Zero address");
        require(shares > 0, "No shares to redeem");
        require(assets > 0, "No assets to redeem");
        require(maxLoss <= Constants.MAX_BPS, "Invalid max loss");
        require(vault.balanceOf(owner) >= shares, "Insufficient shares");

        if (sender != owner) {
            vault._spendAllowance(owner, sender, shares);
        }

        if (vault.withdrawLimitModule != address(0)) {
            require(
                assets <=
                    IWithdrawLimitModule(vault.withdrawLimitModule)
                        .availableWithdrawLimit(owner, maxLoss, _strategies),
                "Exceed withdraw limit"
            );
        }

```

Trong trường hợp số tiền `totalIdle` không đủ lượng rút, bắt đầu rút từ các strategy

```solidity
{
    if (requestedAssets > currentTotalIdle) {
        require(vault.strategies[strategy].activation != 0, "Inactive strategy");
        uint256 currentDebt = vault.strategies[strategy].currentDebt;
        assetsToWithdraw = Math.min(assetsNeeded, currentDebt);
        uint256 maxWithdraw = IStrategy(strategy).convertToAssets(
            IStrategy(strategy).maxRedeem(address(this))
        );

        uint256 unrealisedLossesShare = UnrealisedLossesLogic // tính toán lượng tổn thất tạm thời khi strategy lỗ
            ._assessShareOfUnrealisedLosses(
                strategy,
                currentDebt,
                assetsToWithdraw
            );
        if (unrealisedLossesShare > 0) {   // nếu có tổn thất tạm thời
            // nếu như số tiền maxWithdraw mà nhỏ hơn số tiền muốn rút
            if (
                maxWithdraw < assetsToWithdraw - unrealisedLossesShare
            ) {
                // Điều chỉnh lại phần tổn thất tạm thời theo tỷ lệ
                // Công thức: unrealisedLossesShare = (unrealisedLossesShare * maxWithdraw) / (assetsToWithdraw - unrealisedLossesShare)
                unrealisedLossesShare =
                    (unrealisedLossesShare * maxWithdraw) /
                    (assetsToWithdraw - unrealisedLossesShare);
                // cập nhật lại số tiền muốn rút = số tiền tối đa có thể rút (số rút thực tế + số lỗ)
                assetsToWithdraw = maxWithdraw + unrealisedLossesShare;
            }
            // cập nhật lại số tiền muốn rút
            assetsToWithdraw -= unrealisedLossesShare;
            // cập nhật lại tổng số tiền muốn rút
            requestedAssets -= unrealisedLossesShare;
            // cập nhật lại tổng số tiền muốn rút từ các stratery
            assetsNeeded -= unrealisedLossesShare;
            // cập nhật lại số nợ của strategy
            currentTotalDebt -= unrealisedLossesShare;

            // nếu không thể rút tiền từ strategy này thì cập nhật lại số nợ của strategy
            if (maxWithdraw == 0 && unrealisedLossesShare > 0) {
                vault.strategies[strategy].currentDebt =
                    currentDebt -
                    unrealisedLossesShare;
                emit IVault.DebtUpdated(
                    strategy,
                    currentDebt,
                    vault.strategies[strategy].currentDebt
                );
            }
        }

        // số tiền rút sẽ dựa trên số tiền muốn rút và số tiền tối đa có thể rút
        assetsToWithdraw = Math.min(assetsToWithdraw, maxWithdraw);

        if (assetsToWithdraw == 0) continue;
        // WITHDRAW FROM STRATEGY
        vault._withdrawFromStrategy(strategy, assetsToWithdraw);
        // kiểm tra số tiền thực tế
        uint256 postBalance = IERC20(_asset).balanceOf(address(this));
        uint256 withdrawn = postBalance - previousBalance;
        uint256 loss = 0;
        // trường hợp rút quá số tiền, cần cập nhật lại assetsToWithdraw
        if (withdrawn > assetsToWithdraw) {
            if (withdrawn > currentDebt) {
                assetsToWithdraw = currentDebt;
            } else {
                assetsToWithdraw += withdrawn - assetsToWithdraw;
            }
        } else if (withdrawn < assetsToWithdraw) { // trường hợp rút không đủ như dự tính
            loss = assetsToWithdraw - withdrawn;
        }
        // tăng totalIdle lên sau khi rút
        currentTotalIdle += (assetsToWithdraw - loss);
        // cập nhật lại tổng số tiền muốn rút
        requestedAssets -= loss;
        // cập nhật lại nợ sau khi rút tiền
        currentTotalDebt -= assetsToWithdraw;

        // cập nhật lại debt bởi vì tổn thất tạm thời được gây ra bởi hành động rút tiền
        uint256 newDebt = currentDebt -
            (assetsToWithdraw + unrealisedLossesShare);
        vault.strategies[strategy].currentDebt = newDebt;
        emit IVault.DebtUpdated(strategy, currentDebt, newDebt);
        if (requestedAssets <= currentTotalIdle) break;
        // Cập nhật lại các chỉ số cho strategy tiếp theo
        previousBalance = postBalance;
        assetsNeeded -= assetsToWithdraw;
    }

    // Sau khi rút hết các strategy, kiểm tra xem đã đủ so với yêu cầu rút chưa

    require(
        currentTotalIdle >= requestedAssets,
        "Insufficient assets to withdraw"
    );
    vault.totalDebt = currentTotalDebt;

    // trong trường hợp requestedAssets nhỏ hơn với yêu cầu ban đầu (do có loss) nên kiểm tra điều kiện slippage maxLoss
    if (assets > requestedAssets && maxLoss < Constants.MAX_BPS) {
        require(
            assets - requestedAssets <=
                (assets * maxLoss) / Constants.MAX_BPS,
            "Too much loss"
        );
    }

    vault._burn(owner, shares);
    vault.totalIdle = currentTotalIdle - requestedAssets;
    IERC20(_asset).safeTransfer(receiver, requestedAssets);

    emit IVault.Withdrawn(owner, shares, requestedAssets, 0);
    return requestedAssets;
}
```

### Report

Hàm này sẽ báo cáo các chiến lược lỗ hoặc lời theo cơ chế.

Tính toán lời, lỗ thông qua lịch sử và thực tế

```solidity
  if (totalAssets > currentDebt) {
      gain = totalAssets - currentDebt;
  } else {
      loss = currentDebt - totalAssets;
  }
```

Tính toán lượng totalSupply tiếp theo, sau đó mint burn tương ứng, trong trường hợp lãi, số lp sẽ được mint thêm tại địa chỉ vault, burn dần thông qua giảm totalSupply, nếu lỗ sẽ burn hết lượng lp đang khoá

```solidity
uint256 totalSupply = vault.totalSupply() + lockedShares;
uint256 endingSupply = totalSupply - lockedShares + sharesToLock - sharesToBurn;

if (endingSupply > totalSupply) {
      vault._mint(address(this), endingSupply - totalSupply);
  }
if (totalSupply > endingSupply) {
    uint256 toBurn = Math.min(totalSupply - endingSupply,totalLockedShares);
    vault._burn(address(this), toBurn);
}
```

Sau đó tính toán lại công thức vesting.
