# Withdraw

### Yêu cầu chức năng

- Người dùng rút tài sản bằng cách burn lượng lp tương ứng
- Kho tiền ưu tiên lượng tài sản rảnh rỗi trong vault, nếu không đủ sẽ rút phần thiếu từ các strategy
- Khi rút tiền sớm từ strategy sẽ có khả năng lỗ ( do strategy có thể lỗ), vì thế người dùng có thể nhập 1 giá trị `loss` hoạt động tương tự như slippage có thể châp nhận số tiền lỗ trong khả năng cho phép
- Cho phép B rút tiền từ lp của A nếu đã được approve lượng lp

### Luồng hoạt động

Đầu tiên kiểm tra điều kiện

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
