// 性能监控类
class PerformanceMonitor {
    constructor(config) {
        this.config = config;
        this.cpuCount = navigator.hardwareConcurrency || 4;
        this.networkLatency = 0;
        this.recommendedBrowsers = config.DEFAULT_MAX_BROWSERS;
    }

    // 测试网络延迟
    async testNetworkLatency() {
        const testUrl = this.config.BASE_URL;
        let totalLatency = 0;
        let successCount = 0;

        for (let i = 0; i < this.config.NETWORK_TEST_COUNT; i++) {
            const start = performance.now();
            try {
                const response = await fetch(testUrl, {
                    method: 'HEAD',
                    cache: 'no-store'
                });
                if (response.ok) {
                    const latency = performance.now() - start;
                    totalLatency += latency;
                    successCount++;
                }
            } catch (error) {
                console.warn('网络测试失败:', error);
            }
            // 间隔500ms进行下一次测试
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        this.networkLatency = successCount > 0 ? totalLatency / successCount : 1000;
        return this.networkLatency;
    }

    // 计算推荐的并行数
    calculateRecommendedBrowsers() {
        // 基于CPU核心数的基础值
        let recommended = Math.max(Math.floor(this.cpuCount * 0.75), this.config.MIN_BROWSERS);

        // 基于网络延迟调整
        if (this.networkLatency < 200) {
            // 网络很好，可以增加并行数
            recommended = Math.min(recommended + 2, this.cpuCount);
        } else if (this.networkLatency > 1000) {
            // 网络较差，减少并行数
            recommended = Math.max(recommended - 1, this.config.MIN_BROWSERS);
        }

        // 确保在合理范围内
        this.recommendedBrowsers = Math.min(
            Math.max(recommended, this.config.MIN_BROWSERS),
            this.config.ABSOLUTE_MAX_BROWSERS
        );

        return this.recommendedBrowsers;
    }

    // 获取性能状态描述
    getStatusDescription() {
        return `系统状态：CPU核心数 ${this.cpuCount} | 网络延迟 ${Math.round(this.networkLatency)}ms | 推荐并行数 ${this.recommendedBrowsers}`;
    }
}

module.exports = PerformanceMonitor; 