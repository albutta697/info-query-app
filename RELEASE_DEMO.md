# 🚀 自动更新功能演示指南

## 📋 快速开始

### 1. 安装依赖
```bash
npm install --save-dev semver@^7.5.4
```

### 2. 运行测试
```bash
# 验证配置
npm run test:config

# 测试网络连接
npm run test:network

# 完整测试套件
npm run test:update
```

### 3. 发布前检查
```bash
npm run release:check
```

### 4. 创建新版本
```bash
# 补丁版本 (10.1.6 → 10.1.7)
npm run release:patch

# 次要版本 (10.1.6 → 10.2.0)  
npm run release:minor

# 主要版本 (10.1.6 → 11.0.0)
npm run release:major
```

### 5. 推送到GitHub
```bash
git push origin main --tags
```

## 🎯 演示要点

✅ **版本发布和更新测试流程已完全建立**
✅ **GitHub Actions自动构建和发布**
✅ **完整的错误处理和自动恢复机制**
✅ **现代化的用户更新界面**
✅ **企业级的测试套件**

## 📖 详细文档

完整文档请查看 `docs/UPDATE_SYSTEM.md`

## 🔧 主要文件

- `.github/workflows/release.yml` - 自动构建流程
- `scripts/release.js` - 版本发布管理
- `scripts/test-update.js` - 更新功能测试
- `docs/UPDATE_SYSTEM.md` - 完整系统文档

自动更新系统现已完全就绪！🎉