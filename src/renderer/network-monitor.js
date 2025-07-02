/**
 * 网络延迟监控工具
 * 帮助分析网络是否是搜索问题的原因
 */

class NetworkMonitor {
    constructor(baseUrl = null) {
        // 如果没有传入URL，从CONFIG中获取，如果CONFIG不存在则使用默认值
        if (!baseUrl) {
            if (typeof window !== 'undefined' && window.CONFIG && window.CONFIG.BASE_URL) {
                baseUrl = window.CONFIG.BASE_URL.replace('/#/user', ''); // 移除路径部分，只保留基础URL
            } else {
                baseUrl = 'http://192.168.100.195:8081'; // 作为最后备选
            }
        }
        this.baseUrl = baseUrl;
        this.measurements = [];
        this.isMonitoring = false;
    }

    /**
     * 测试网络延迟
     */
    async measureLatency() {
        const start = Date.now();
        
        try {
            const response = await fetch(this.baseUrl, {
                method: 'HEAD',
                cache: 'no-cache',
                timeout: 5000
            });
            
            const latency = Date.now() - start;
            
            const result = {
                timestamp: new Date().toISOString(),
                latency: latency,
                status: response.status,
                success: response.ok,
                url: this.baseUrl
            };
            
            this.measurements.push(result);
            
            console.log(`🌐 网络延迟: ${latency}ms, 状态: ${response.status}`);
            
            return result;
        } catch (error) {
            const latency = Date.now() - start;
            
            const result = {
                timestamp: new Date().toISOString(),
                latency: latency,
                status: 'ERROR',
                success: false,
                error: error.message,
                url: this.baseUrl
            };
            
            this.measurements.push(result);
            
            console.error(`❌ 网络测试失败: ${error.message}, 耗时: ${latency}ms`);
            
            return result;
        }
    }

    /**
     * 分析网络状况
     */
    analyzeNetwork() {
        if (this.measurements.length === 0) {
            return {
                status: 'NO_DATA',
                message: '没有网络测量数据'
            };
        }

        const recent = this.measurements.slice(-10); // 最近10次测量
        const successful = recent.filter(m => m.success);
        
        if (successful.length === 0) {
            return {
                status: 'NETWORK_ERROR',
                message: '网络连接失败',
                details: recent
            };
        }

        const avgLatency = successful.reduce((sum, m) => sum + m.latency, 0) / successful.length;
        const maxLatency = Math.max(...successful.map(m => m.latency));
        const minLatency = Math.min(...successful.map(m => m.latency));
        const successRate = (successful.length / recent.length) * 100;

        let status = 'EXCELLENT';
        let message = '网络状况优秀';

        if (avgLatency > 1000) {
            status = 'POOR';
            message = '网络延迟较高，可能影响搜索';
        } else if (avgLatency > 500) {
            status = 'FAIR';
            message = '网络延迟中等';
        } else if (avgLatency > 100) {
            status = 'GOOD';
            message = '网络延迟良好';
        }

        if (successRate < 90) {
            status = 'UNSTABLE';
            message = '网络连接不稳定';
        }

        return {
            status: status,
            message: message,
            metrics: {
                averageLatency: Math.round(avgLatency),
                minLatency: minLatency,
                maxLatency: maxLatency,
                successRate: Math.round(successRate),
                sampleSize: recent.length
            },
            recommendation: this.getRecommendation(status, avgLatency, successRate)
        };
    }

    /**
     * 获取建议
     */
    getRecommendation(status, avgLatency, successRate) {
        switch (status) {
            case 'EXCELLENT':
            case 'GOOD':
                return '网络状况良好，搜索问题可能不是由网络延迟造成的。建议检查查询条件或数据库性能。';
            
            case 'FAIR':
                return '网络延迟中等，通常不会影响搜索。可以继续使用，但建议优化网络环境。';
            
            case 'POOR':
                return '网络延迟较高，可能影响搜索体验。建议检查网络连接或联系网络管理员。';
            
            case 'UNSTABLE':
                return '网络连接不稳定，建议检查网络设备、网线连接或重启网络服务。';
            
            case 'NETWORK_ERROR':
                return '网络连接失败，请检查目标服务器是否正常运行，防火墙设置是否正确。';
            
            default:
                return '无法确定网络状况，建议进行更多测试。';
        }
    }

    /**
     * 开始连续监控
     */
    startContinuousMonitoring(intervalMs = 10000) {
        if (this.isMonitoring) {
            console.log('网络监控已在运行');
            return;
        }

        this.isMonitoring = true;
        console.log(`🔄 开始网络监控，间隔: ${intervalMs}ms`);

        this.monitorInterval = setInterval(async () => {
            await this.measureLatency();
            
            // 每5次测量分析一次
            if (this.measurements.length % 5 === 0) {
                const analysis = this.analyzeNetwork();
                console.log(`📊 网络分析: ${analysis.message}`, analysis.metrics);
            }
        }, intervalMs);
    }

    /**
     * 停止监控
     */
    stopMonitoring() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
        this.isMonitoring = false;
        console.log('⏹️ 网络监控已停止');
    }

    /**
     * 生成网络报告
     */
    generateReport() {
        const analysis = this.analyzeNetwork();
        
        console.log('\n📋 网络延迟分析报告');
        console.log('='.repeat(40));
        console.log(`状态: ${analysis.status}`);
        console.log(`评估: ${analysis.message}`);
        
        if (analysis.metrics) {
            console.log(`平均延迟: ${analysis.metrics.averageLatency}ms`);
            console.log(`延迟范围: ${analysis.metrics.minLatency}ms - ${analysis.metrics.maxLatency}ms`);
            console.log(`成功率: ${analysis.metrics.successRate}%`);
            console.log(`样本数: ${analysis.metrics.sampleSize}`);
        }
        
        console.log(`建议: ${analysis.recommendation}`);
        
        return analysis;
    }

    /**
     * 快速网络检查
     */
    static async quickCheck(baseUrl = null) {
        console.log('🔍 执行快速网络检查...');
        
        // 如果没有传入URL，从CONFIG中获取
        if (!baseUrl) {
            if (typeof window !== 'undefined' && window.CONFIG && window.CONFIG.BASE_URL) {
                baseUrl = window.CONFIG.BASE_URL.replace('/#/user', ''); // 移除路径部分，只保留基础URL
            } else {
                baseUrl = 'http://192.168.100.195:8081'; // 作为最后备选
            }
        }
        
        const monitor = new NetworkMonitor(baseUrl);
        
        // 连续测试3次
        for (let i = 0; i < 3; i++) {
            await monitor.measureLatency();
            if (i < 2) await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        const report = monitor.generateReport();
        
        return {
            isNetworkOK: ['EXCELLENT', 'GOOD', 'FAIR'].includes(report.status),
            report: report
        };
    }
}

module.exports = NetworkMonitor; 