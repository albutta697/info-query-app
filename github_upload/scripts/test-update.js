#!/usr/bin/env node

/**
 * 自动更新功能测试脚本
 * 用于测试完整的更新流程和各种边缘情况
 */

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const net = require('net');

class UpdateTester {
    constructor() {
        this.packagePath = path.join(__dirname, '../package.json');
        this.package = JSON.parse(fs.readFileSync(this.packagePath, 'utf8'));
        this.testResults = [];
        
        console.log('🧪 自动更新功能测试工具');
        console.log('📦 当前版本:', this.package.version);
    }

    /**
     * 运行完整的更新测试套件
     */
    async runFullTestSuite() {
        console.log('\n🚀 开始完整更新测试套件...\n');
        
        const tests = [
            { name: '配置验证测试', fn: this.testConfiguration },
            { name: 'GitHub连接测试', fn: this.testGitHubConnectivity },
            { name: '版本检查测试', fn: this.testVersionCheck },
            { name: '更新文件验证测试', fn: this.testUpdateFiles },
            { name: '错误处理测试', fn: this.testErrorHandling },
            { name: '网络故障恢复测试', fn: this.testNetworkFailureRecovery },
            { name: '更新UI组件测试', fn: this.testUpdateUI },
            { name: '用户交互测试', fn: this.testUserInteraction }
        ];
        
        for (const test of tests) {
            await this.runTest(test.name, test.fn);
        }
        
        this.generateTestReport();
    }

    /**
     * 运行单个测试
     */
    async runTest(testName, testFn) {
        console.log(`🔍 ${testName}...`);
        const startTime = Date.now();
        
        try {
            await testFn.call(this);
            const duration = Date.now() - startTime;
            console.log(`  ✅ ${testName} 通过 (${duration}ms)`);
            this.testResults.push({ name: testName, status: 'PASS', duration });
        } catch (error) {
            const duration = Date.now() - startTime;
            console.log(`  ❌ ${testName} 失败: ${error.message} (${duration}ms)`);
            this.testResults.push({ name: testName, status: 'FAIL', duration, error: error.message });
        }
        
        console.log(''); // 空行分隔
    }

    /**
     * 测试配置验证
     */
    async testConfiguration() {
        // 测试package.json配置
        const build = this.package.build;
        if (!build) {
            throw new Error('缺少build配置');
        }
        
        if (!build.publish) {
            throw new Error('缺少publish配置');
        }
        
        if (build.publish.provider === 'github') {
            if (!build.publish.owner || !build.publish.repo) {
                throw new Error('GitHub配置不完整');
            }
        }
        
        // 测试主进程文件
        const mainFile = path.join(__dirname, '../src/main/main.js');
        const mainContent = fs.readFileSync(mainFile, 'utf8');
        
        if (!mainContent.includes('electron-updater')) {
            throw new Error('主进程未集成electron-updater');
        }
        
        if (!mainContent.includes('autoUpdater')) {
            throw new Error('主进程未配置autoUpdater');
        }
        
        console.log('    ✓ package.json配置正确');
        console.log('    ✓ 主进程集成electron-updater');
    }

    /**
     * 测试GitHub连接
     */
    async testGitHubConnectivity() {
        const { owner, repo } = this.package.build.publish;
        
        // 测试GitHub API访问
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
        const response = await this.fetchWithTimeout(apiUrl, 10000);
        
        if (!response.ok) {
            throw new Error(`GitHub API访问失败: ${response.status} ${response.statusText}`);
        }
        
        const repoInfo = await response.json();
        console.log(`    ✓ 仓库: ${repoInfo.full_name}`);
        console.log(`    ✓ 可见性: ${repoInfo.private ? 'Private' : 'Public'}`);
        
        // 测试Releases API
        const releasesUrl = `https://api.github.com/repos/${owner}/${repo}/releases`;
        const releasesResponse = await this.fetchWithTimeout(releasesUrl, 10000);
        
        if (!releasesResponse.ok) {
            throw new Error(`Releases API访问失败: ${releasesResponse.status}`);
        }
        
        const releases = await releasesResponse.json();
        console.log(`    ✓ 找到 ${releases.length} 个发布版本`);
        
        if (releases.length > 0) {
            const latestRelease = releases[0];
            console.log(`    ✓ 最新版本: ${latestRelease.tag_name}`);
        }
    }

    /**
     * 测试版本检查
     */
    async testVersionCheck() {
        const currentVersion = this.package.version;
        
        // 模拟版本比较逻辑
        const semver = require('semver');
        
        // 测试版本格式
        if (!semver.valid(currentVersion)) {
            throw new Error(`无效的版本格式: ${currentVersion}`);
        }
        
        console.log(`    ✓ 当前版本格式有效: ${currentVersion}`);
        
        // 测试版本比较
        const testVersions = [
            { version: '10.1.5', expected: 'newer' },
            { version: '10.1.6', expected: 'same' },
            { version: '10.1.7', expected: 'older' },
            { version: '10.2.0', expected: 'older' },
            { version: '11.0.0', expected: 'older' }
        ];
        
        for (const test of testVersions) {
            const comparison = semver.compare(currentVersion, test.version);
            let result;
            
            if (comparison > 0) result = 'newer';
            else if (comparison < 0) result = 'older';
            else result = 'same';
            
            if (result !== test.expected) {
                throw new Error(`版本比较错误: ${currentVersion} vs ${test.version}, 期望 ${test.expected}, 实际 ${result}`);
            }
        }
        
        console.log('    ✓ 版本比较逻辑正确');
    }

    /**
     * 测试更新文件验证
     */
    async testUpdateFiles() {
        // 检查更新相关文件是否存在
        const requiredFiles = [
            'src/main/main.js',
            'src/renderer/renderer.js',
            'src/renderer/index.html',
            'src/renderer/styles.css'
        ];
        
        for (const file of requiredFiles) {
            const filePath = path.join(__dirname, '..', file);
            if (!fs.existsSync(filePath)) {
                throw new Error(`缺少必要文件: ${file}`);
            }
        }
        
        console.log('    ✓ 所有必要文件存在');
        
        // 检查渲染进程的更新UI组件
        const indexPath = path.join(__dirname, '../src/renderer/index.html');
        const indexContent = fs.readFileSync(indexPath, 'utf8');
        
        const requiredElements = [
            'updateStatusIndicator',
            'updateNotificationModal',
            'updateCompleteNotification',
            'updateErrorNotification',
            'updateSettingsPanel'
        ];
        
        for (const element of requiredElements) {
            if (!indexContent.includes(element)) {
                throw new Error(`HTML中缺少更新UI元素: ${element}`);
            }
        }
        
        console.log('    ✓ 更新UI组件完整');
        
        // 检查CSS样式
        const stylesPath = path.join(__dirname, '../src/renderer/styles.css');
        const stylesContent = fs.readFileSync(stylesPath, 'utf8');
        
        const requiredStyles = [
            'update-status-indicator',
            'update-notification-modal',
            'progress-bar',
            'recovery-options',
            'error-classification-details'
        ];
        
        for (const style of requiredStyles) {
            if (!stylesContent.includes(style)) {
                throw new Error(`CSS中缺少样式: ${style}`);
            }
        }
        
        console.log('    ✓ 更新样式完整');
    }

    /**
     * 测试错误处理
     */
    async testErrorHandling() {
        // 测试网络错误处理
        try {
            await this.fetchWithTimeout('https://invalid-domain-for-testing.com', 5000);
            throw new Error('应该抛出网络错误');
        } catch (error) {
            if (error.message.includes('应该抛出')) {
                throw error;
            }
            console.log('    ✓ 网络错误处理正常');
        }
        
        // 测试主进程错误处理逻辑
        const mainPath = path.join(__dirname, '../src/main/main.js');
        const mainContent = fs.readFileSync(mainPath, 'utf8');
        
        const errorHandlingFeatures = [
            'classifyUpdateError',
            'retryUpdateCheck',
            'checkNetworkConnectivity',
            'clearUpdateCache',
            'logUpdateError'
        ];
        
        for (const feature of errorHandlingFeatures) {
            if (!mainContent.includes(feature)) {
                throw new Error(`缺少错误处理功能: ${feature}`);
            }
        }
        
        console.log('    ✓ 错误处理功能完整');
    }

    /**
     * 测试网络故障恢复
     */
    async testNetworkFailureRecovery() {
        // 模拟网络连接测试
        const testHosts = [
            { host: 'api.github.com', port: 443 },
            { host: 'github.com', port: 443 },
            { host: 'raw.githubusercontent.com', port: 443 }
        ];
        
        for (const { host, port } of testHosts) {
            const isReachable = await this.testTCPConnection(host, port, 5000);
            if (!isReachable) {
                throw new Error(`无法连接到 ${host}:${port}`);
            }
            console.log(`    ✓ ${host} 连接正常`);
        }
        
        // 检查重试机制配置
        const mainPath = path.join(__dirname, '../src/main/main.js');
        const mainContent = fs.readFileSync(mainPath, 'utf8');
        
        if (!mainContent.includes('MAX_RETRY_ATTEMPTS')) {
            throw new Error('缺少重试机制配置');
        }
        
        console.log('    ✓ 网络恢复机制配置正确');
    }

    /**
     * 测试更新UI组件
     */
    async testUpdateUI() {
        const rendererPath = path.join(__dirname, '../src/renderer/renderer.js');
        const rendererContent = fs.readFileSync(rendererPath, 'utf8');
        
        // 检查UpdateManager类
        if (!rendererContent.includes('class UpdateManager')) {
            throw new Error('缺少UpdateManager类');
        }
        
        // 检查关键方法
        const requiredMethods = [
            'initErrorRecovery',
            'handleEnhancedError',
            'showRecoveryOptions',
            'executeRecoveryAction',
            'bindErrorRecoveryEvents'
        ];
        
        for (const method of requiredMethods) {
            if (!rendererContent.includes(method)) {
                throw new Error(`UpdateManager缺少方法: ${method}`);
            }
        }
        
        console.log('    ✓ UpdateManager类完整');
        console.log('    ✓ 错误恢复方法齐全');
    }

    /**
     * 测试用户交互
     */
    async testUserInteraction() {
        // 检查IPC通信处理器
        const mainPath = path.join(__dirname, '../src/main/main.js');
        const mainContent = fs.readFileSync(mainPath, 'utf8');
        
        const requiredIPCHandlers = [
            'check-for-updates',
            'download-update',
            'install-update',
            'get-update-settings',
            'retry-update',
            'execute-recovery-strategy'
        ];
        
        for (const handler of requiredIPCHandlers) {
            if (!mainContent.includes(`'${handler}'`)) {
                throw new Error(`缺少IPC处理器: ${handler}`);
            }
        }
        
        console.log('    ✓ IPC通信处理器完整');
        
        // 检查渲染进程事件绑定
        const rendererPath = path.join(__dirname, '../src/renderer/renderer.js');
        const rendererContent = fs.readFileSync(rendererPath, 'utf8');
        
        if (!rendererContent.includes('bindErrorRecoveryEvents')) {
            throw new Error('缺少错误恢复事件绑定');
        }
        
        console.log('    ✓ 用户交互事件绑定正确');
    }

    /**
     * 带超时的fetch请求
     */
    async fetchWithTimeout(url, timeout = 10000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        try {
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    /**
     * 测试TCP连接
     */
    async testTCPConnection(host, port, timeout = 5000) {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            
            const timeoutId = setTimeout(() => {
                socket.destroy();
                resolve(false);
            }, timeout);
            
            socket.on('connect', () => {
                clearTimeout(timeoutId);
                socket.destroy();
                resolve(true);
            });
            
            socket.on('error', () => {
                clearTimeout(timeoutId);
                resolve(false);
            });
            
            socket.connect(port, host);
        });
    }

    /**
     * 生成测试报告
     */
    generateTestReport() {
        console.log('\n📊 测试报告');
        console.log('='.repeat(50));
        
        const passedTests = this.testResults.filter(test => test.status === 'PASS');
        const failedTests = this.testResults.filter(test => test.status === 'FAIL');
        
        console.log(`总测试数: ${this.testResults.length}`);
        console.log(`通过: ${passedTests.length} ✅`);
        console.log(`失败: ${failedTests.length} ❌`);
        console.log(`通过率: ${((passedTests.length / this.testResults.length) * 100).toFixed(1)}%`);
        
        if (failedTests.length > 0) {
            console.log('\n❌ 失败的测试:');
            failedTests.forEach(test => {
                console.log(`  - ${test.name}: ${test.error}`);
            });
        }
        
        const totalDuration = this.testResults.reduce((sum, test) => sum + test.duration, 0);
        console.log(`\n⏱️  总耗时: ${totalDuration}ms`);
        
        // 保存报告到文件
        const reportPath = path.join(__dirname, '../test-report.json');
        fs.writeFileSync(reportPath, JSON.stringify({
            timestamp: new Date().toISOString(),
            results: this.testResults,
            summary: {
                total: this.testResults.length,
                passed: passedTests.length,
                failed: failedTests.length,
                passRate: ((passedTests.length / this.testResults.length) * 100).toFixed(1),
                duration: totalDuration
            }
        }, null, 2));
        
        console.log(`\n📄 详细报告已保存到: ${reportPath}`);
        
        if (failedTests.length > 0) {
            process.exit(1);
        }
    }

    /**
     * 显示帮助信息
     */
    showHelp() {
        console.log(`
🧪 自动更新功能测试工具

用法:
  node scripts/test-update.js [命令]

命令:
  test      运行完整测试套件
  config    仅测试配置验证
  network   仅测试网络连接
  help      显示此帮助信息

示例:
  node scripts/test-update.js test      # 运行完整测试
  node scripts/test-update.js config    # 测试配置
  node scripts/test-update.js network   # 测试网络连接
        `);
    }
}

// 主程序入口
async function main() {
    const tester = new UpdateTester();
    const command = process.argv[2] || 'help';
    
    try {
        switch (command) {
            case 'test':
                await tester.runFullTestSuite();
                break;
            case 'config':
                await tester.runTest('配置验证测试', tester.testConfiguration);
                break;
            case 'network':
                await tester.runTest('网络连接测试', tester.testGitHubConnectivity);
                break;
            case 'help':
            default:
                tester.showHelp();
                break;
        }
    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        process.exit(1);
    }
}

// 如果是直接运行此脚本
if (require.main === module) {
    main();
}

module.exports = UpdateTester; 