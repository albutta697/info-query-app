/**
 * 高级检测器测试和使用示例
 * 这个文件展示了如何使用新集成的高级判断法
 */

const AdvancedDetector = require('./advanced-detector');

class AdvancedDetectorTester {
    constructor() {
        this.detector = new AdvancedDetector();
    }

    /**
     * 测试高级检测器的各项功能
     */
    async runTests(page) {
        console.log('🚀 开始测试高级检测器功能...');
        
        const results = {
            dataStateTest: null,
            advancedSearchTest: null,
            pageSizeTest: null,
            pageReadinessTest: null,
            dataChangeTest: null
        };

        try {
            // 测试1：数据状态获取
            console.log('\n📊 测试1：数据状态获取');
            results.dataStateTest = await this.testDataState(page);
            
            // 测试2：高级搜索状态检测
            console.log('\n🔍 测试2：高级搜索状态检测');
            results.advancedSearchTest = await this.testAdvancedSearch(page);
            
            // 测试3：分页设置检测
            console.log('\n📄 测试3：分页设置检测');
            results.pageSizeTest = await this.testPageSize(page);
            
            // 测试4：综合页面准备状态
            console.log('\n✅ 测试4：综合页面准备状态');
            results.pageReadinessTest = await this.testPageReadiness(page);
            
            // 测试5：数据变化检测（可选）
            console.log('\n🔄 测试5：数据变化检测');
            results.dataChangeTest = await this.testDataChange(page);
            
        } catch (error) {
            console.error('❌ 测试过程中发生错误:', error);
        }

        // 生成测试报告
        this.generateTestReport(results);
        
        return results;
    }

    /**
     * 测试数据状态获取
     */
    async testDataState(page) {
        try {
            const dataState = await this.detector.getDataState(page);
            
            console.log('数据状态检测结果:', {
                数据总数: dataState.dataCount,
                数据文本: dataState.dataCountText,
                有数据表格: dataState.hasDataTable,
                表格行数: dataState.tableRows,
                当前页码: dataState.pageNumber,
                有效内容: dataState.hasValidContent,
                无数据页面: dataState.isNoDataPage
            });
            
            return {
                success: true,
                result: dataState,
                evaluation: this.evaluateDataState(dataState)
            };
        } catch (error) {
            console.error('数据状态测试失败:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 测试高级搜索状态检测
     */
    async testAdvancedSearch(page) {
        try {
            const advancedResult = await this.detector.checkAdvancedSearchExpanded(page);
            
            console.log('高级搜索检测结果:', {
                展开状态: advancedResult.isExpanded ? '已展开' : '未展开',
                找到字段: `${advancedResult.foundFields}/${advancedResult.totalAdvancedFields}`,
                扩展评分: `${Math.round(advancedResult.expansionScore * 100)}%`,
                字段详情: advancedResult.foundFieldDetails,
                字段状态: advancedResult.fieldStatus
            });
            
            return {
                success: true,
                result: advancedResult,
                evaluation: this.evaluateAdvancedSearch(advancedResult)
            };
        } catch (error) {
            console.error('高级搜索测试失败:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 测试分页设置检测
     */
    async testPageSize(page) {
        try {
            const pageSizeResult = await this.detector.checkPageSizeIs100(page);
            
            console.log('分页设置检测结果:', {
                是否100每页: pageSizeResult.is100PerPage ? '是' : '否',
                当前设置: pageSizeResult.currentPageSize ? `${pageSizeResult.currentPageSize}/页` : '未找到',
                元素文本: pageSizeResult.pageSizeElementText || '无',
                所有分页文本: pageSizeResult.allPageSizeTexts
            });
            
            return {
                success: true,
                result: pageSizeResult,
                evaluation: this.evaluatePageSize(pageSizeResult)
            };
        } catch (error) {
            console.error('分页设置测试失败:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 测试综合页面准备状态
     */
    async testPageReadiness(page) {
        try {
            const readiness = await this.detector.checkPageReadiness(page);
            
            console.log('页面准备状态检测结果:', {
                准备就绪: readiness.isReady ? '是' : '否',
                评分: `${readiness.score}%`,
                检查项目: readiness.checks,
                问题列表: readiness.issues.length > 0 ? readiness.issues : '无问题'
            });
            
            return {
                success: true,
                result: readiness,
                evaluation: this.evaluatePageReadiness(readiness)
            };
        } catch (error) {
            console.error('页面准备状态测试失败:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 测试数据变化检测
     */
    async testDataChange(page) {
        try {
            console.log('开始短期数据变化检测 (5秒)...');
            const changeResult = await this.detector.detectDataChange(page, 5000);
            
            console.log('数据变化检测结果:', {
                检测成功: changeResult.success ? '是' : '否',
                变化类型: changeResult.changeType || '无变化',
                持续时间: `${changeResult.duration}ms`,
                检测次数: changeResult.attempts
            });
            
            return {
                success: true,
                result: changeResult,
                evaluation: this.evaluateDataChange(changeResult)
            };
        } catch (error) {
            console.error('数据变化测试失败:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 评估数据状态
     */
    evaluateDataState(dataState) {
        const issues = [];
        const strengths = [];
        
        if (dataState.dataCount > 0) {
            strengths.push('有效的数据计数');
        } else {
            issues.push('缺少数据计数');
        }
        
        if (dataState.hasDataTable) {
            strengths.push('数据表格存在');
        } else {
            issues.push('数据表格缺失');
        }
        
        if (dataState.hasValidContent) {
            strengths.push('表格内容有效');
        } else {
            issues.push('表格内容无效或为空');
        }
        
        return {
            score: Math.round((strengths.length / (strengths.length + issues.length)) * 100),
            strengths: strengths,
            issues: issues
        };
    }

    /**
     * 评估高级搜索状态
     */
    evaluateAdvancedSearch(advancedResult) {
        return {
            score: Math.round(advancedResult.expansionScore * 100),
            isOptimal: advancedResult.isExpanded,
            fieldCoverage: `${advancedResult.foundFields}/${advancedResult.totalAdvancedFields}`,
            recommendation: advancedResult.isExpanded ? '高级搜索已正确展开' : '建议确保高级搜索已展开'
        };
    }

    /**
     * 评估分页设置
     */
    evaluatePageSize(pageSizeResult) {
        return {
            score: pageSizeResult.is100PerPage ? 100 : 0,
            isOptimal: pageSizeResult.is100PerPage,
            currentSetting: pageSizeResult.currentPageSize,
            recommendation: pageSizeResult.is100PerPage ? '分页设置已优化' : '建议设置为100/页以提高效率'
        };
    }

    /**
     * 评估页面准备状态
     */
    evaluatePageReadiness(readiness) {
        return {
            score: readiness.score,
            isOptimal: readiness.isReady,
            passedChecks: Object.values(readiness.checks).filter(Boolean).length,
            totalChecks: Object.keys(readiness.checks).length,
            recommendation: readiness.isReady ? '页面已准备就绪' : `需要解决以下问题: ${readiness.issues.join(', ')}`
        };
    }

    /**
     * 评估数据变化检测
     */
    evaluateDataChange(changeResult) {
        return {
            score: changeResult.success ? 100 : 0,
            isOptimal: changeResult.success,
            responseTime: changeResult.duration,
            recommendation: changeResult.success ? '数据变化检测正常' : '在短期内未检测到数据变化，可能需要更长时间'
        };
    }

    /**
     * 生成测试报告
     */
    generateTestReport(results) {
        console.log('\n📋 高级检测器测试报告');
        console.log('='.repeat(50));
        
        let totalScore = 0;
        let totalTests = 0;
        
        Object.entries(results).forEach(([testName, result]) => {
            if (result && result.success) {
                const evaluation = result.evaluation;
                const score = evaluation ? evaluation.score : 0;
                totalScore += score;
                totalTests++;
                
                console.log(`\n✅ ${testName}:`);
                console.log(`   评分: ${score}%`);
                if (evaluation.recommendation) {
                    console.log(`   建议: ${evaluation.recommendation}`);
                }
            } else if (result) {
                console.log(`\n❌ ${testName}: 失败 - ${result.error}`);
            }
        });
        
        const averageScore = totalTests > 0 ? Math.round(totalScore / totalTests) : 0;
        
        console.log('\n📊 总体评估:');
        console.log(`   完成测试: ${totalTests}/${Object.keys(results).length}`);
        console.log(`   平均评分: ${averageScore}%`);
        console.log(`   整体状态: ${averageScore >= 80 ? '优秀' : averageScore >= 60 ? '良好' : '需要改进'}`);
        
        console.log('\n💡 使用建议:');
        console.log('1. 评分80%以上表示系统运行良好');
        console.log('2. 评分60-80%表示部分功能需要优化');
        console.log('3. 评分60%以下表示需要检查系统配置');
        console.log('4. 可以定期运行此测试来监控系统状态');
        
        console.log('\n🔧 集成指南:');
        console.log('- 在BrowserManager中已集成高级检测器');
        console.log('- 页面准备检查: browserManager.checkDataRefreshSuccess(page)');
        console.log('- 高级搜索检查: browserManager.checkAdvancedSearchExpanded(page)');
        console.log('- 分页设置检查: browserManager.checkPageSizeIs100(page)');
        console.log('- 数据变化等待: browserManager.advancedDetector.waitForQueryComplete(page)');
        
        return {
            averageScore: averageScore,
            completedTests: totalTests,
            totalTests: Object.keys(results).length,
            status: averageScore >= 80 ? 'excellent' : averageScore >= 60 ? 'good' : 'needs_improvement'
        };
    }

    /**
     * 清理资源
     */
    cleanup() {
        if (this.detector) {
            this.detector.cleanup();
        }
    }
}

// 使用示例函数
async function demonstrateUsage(page) {
    console.log('\n🎯 高级检测器使用示例');
    console.log('='.repeat(30));
    
    const detector = new AdvancedDetector();
    
    try {
        // 示例1：快速页面状态检查
        console.log('\n示例1：快速页面状态检查');
        const readiness = await detector.checkPageReadiness(page);
        console.log(`页面准备状态: ${readiness.isReady ? '就绪' : '未就绪'} (${readiness.score}%)`);
        
        // 示例2：等待查询完成
        console.log('\n示例2：等待查询完成');
        const queryResult = await detector.waitForQueryComplete(page, 10000);
        console.log(`查询完成状态: ${queryResult.success ? '成功' : '失败'}`);
        
        // 示例3：检查具体配置项
        console.log('\n示例3：检查具体配置项');
        const [advanced, pageSize] = await Promise.all([
            detector.checkAdvancedSearchExpanded(page),
            detector.checkPageSizeIs100(page)
        ]);
        
        console.log(`高级搜索: ${advanced.isExpanded ? '已展开' : '未展开'} (${Math.round(advanced.expansionScore * 100)}%)`);
        console.log(`分页设置: ${pageSize.is100PerPage ? '100/页' : `${pageSize.currentPageSize}/页`}`);
        
    } catch (error) {
        console.error('使用示例执行失败:', error);
    } finally {
        detector.cleanup();
    }
}

module.exports = {
    AdvancedDetectorTester,
    demonstrateUsage
}; 