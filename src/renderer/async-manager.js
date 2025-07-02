// 异步操作管理器
class AsyncManager {
    constructor() {
        this.activeOperations = new Map(); // 活动操作映射
        this.operationQueue = new Map(); // 操作队列
        this.cancellationTokens = new Map(); // 取消令牌
        this.maxConcurrentOps = 5; // 最大并发操作数
        this.operationTimeouts = new Map(); // 操作超时映射
        
        // 绑定清理定时器
        this.setupCleanupTimer();
    }
    
    // 设置清理定时器
    setupCleanupTimer() {
        this.cleanupTimer = setInterval(() => {
            this.cleanupExpiredOperations();
        }, 30000); // 每30秒清理过期操作
    }
    
    // 创建可取消的操作
    createCancellableOperation(operationId, operation, timeout = 30000) {
        // 检查是否已有同类操作在进行
        if (this.activeOperations.has(operationId)) {
            logger.warn(`异步管理器: 操作 ${operationId} 已在进行中，取消之前的操作`);
            this.cancelOperation(operationId);
        }
        
        // 创建取消令牌
        const cancellationToken = {
            cancelled: false,
            reason: null,
            cancel: (reason = 'Operation cancelled') => {
                cancellationToken.cancelled = true;
                cancellationToken.reason = reason;
            }
        };
        
        this.cancellationTokens.set(operationId, cancellationToken);
        
        // 创建可取消的Promise
        const cancellablePromise = new Promise(async (resolve, reject) => {
            try {
                // 设置超时
                const timeoutId = setTimeout(() => {
                    if (!cancellationToken.cancelled) {
                        cancellationToken.cancel('Operation timeout');
                        reject(new Error(`操作超时: ${operationId}`));
                    }
                }, timeout);
                
                this.operationTimeouts.set(operationId, timeoutId);
                
                // 执行操作
                const result = await operation(cancellationToken);
                
                // 清理超时
                clearTimeout(timeoutId);
                this.operationTimeouts.delete(operationId);
                
                // 检查是否被取消
                if (cancellationToken.cancelled) {
                    reject(new Error(cancellationToken.reason));
                } else {
                    resolve(result);
                }
            } catch (error) {
                reject(error);
            } finally {
                // 清理操作记录
                this.activeOperations.delete(operationId);
                this.cancellationTokens.delete(operationId);
            }
        });
        
        // 记录活动操作
        this.activeOperations.set(operationId, {
            promise: cancellablePromise,
            startTime: Date.now(),
            timeout: timeout
        });
        
        return cancellablePromise;
    }
    
    // 取消操作
    cancelOperation(operationId, reason = 'Operation cancelled') {
        const token = this.cancellationTokens.get(operationId);
        if (token) {
            token.cancel(reason);
            logger.info(`异步管理器: 已取消操作 ${operationId}, 原因: ${reason}`);
        }
        
        // 清理超时
        const timeoutId = this.operationTimeouts.get(operationId);
        if (timeoutId) {
            clearTimeout(timeoutId);
            this.operationTimeouts.delete(operationId);
        }
    }
    
    // 取消所有操作
    cancelAllOperations(reason = 'All operations cancelled') {
        const operationIds = Array.from(this.activeOperations.keys());
        operationIds.forEach(id => this.cancelOperation(id, reason));
        logger.info(`异步管理器: 已取消所有操作 (${operationIds.length}个)`);
    }
    
    // 并发控制的批量执行
    async executeBatch(operations, concurrency = null) {
        const actualConcurrency = concurrency || this.maxConcurrentOps;
        const results = [];
        const errors = [];
        
        // 分批执行
        for (let i = 0; i < operations.length; i += actualConcurrency) {
            const batch = operations.slice(i, i + actualConcurrency);
            
            try {
                const batchResults = await Promise.allSettled(
                    batch.map(op => this.createCancellableOperation(
                        `batch_${i}_${Date.now()}`, 
                        op.operation, 
                        op.timeout || 30000
                    ))
                );
                
                batchResults.forEach((result, index) => {
                    if (result.status === 'fulfilled') {
                        results.push(result.value);
                    } else {
                        errors.push({
                            index: i + index,
                            error: result.reason
                        });
                    }
                });
            } catch (error) {
                logger.error('异步管理器: 批量执行失败', 'batch_execution', error);
                errors.push({ batch: i, error });
            }
        }
        
        return { results, errors };
    }
    
    // 串行执行（一个接一个）
    async executeSequential(operations) {
        const results = [];
        const errors = [];
        
        for (let i = 0; i < operations.length; i++) {
            const op = operations[i];
            try {
                const result = await this.createCancellableOperation(
                    `sequential_${i}_${Date.now()}`,
                    op.operation,
                    op.timeout || 30000
                );
                results.push(result);
            } catch (error) {
                logger.error(`异步管理器: 串行执行第${i}个操作失败`, 'sequential_execution', error);
                errors.push({ index: i, error });
                
                // 如果是重要操作，可以选择停止后续执行
                if (op.critical) {
                    break;
                }
            }
        }
        
        return { results, errors };
    }
    
    // 带重试的执行
    async executeWithRetry(operationId, operation, maxRetries = 3, retryDelay = 1000) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const result = await this.createCancellableOperation(
                    `${operationId}_attempt_${attempt}`,
                    operation,
                    30000
                );
                
                if (attempt > 1) {
                    logger.info(`异步管理器: 操作 ${operationId} 在第${attempt}次尝试后成功`);
                }
                
                return result;
            } catch (error) {
                lastError = error;
                logger.warn(`异步管理器: 操作 ${operationId} 第${attempt}次尝试失败`, 'retry_execution', error);
                
                if (attempt < maxRetries) {
                    // 等待后重试
                    await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
                }
            }
        }
        
        throw new Error(`操作 ${operationId} 在${maxRetries}次重试后仍然失败: ${lastError.message}`);
    }
    
    // 检查操作状态
    getOperationStatus(operationId) {
        const operation = this.activeOperations.get(operationId);
        const token = this.cancellationTokens.get(operationId);
        
        if (!operation) {
            return { status: 'not_found' };
        }
        
        return {
            status: token && token.cancelled ? 'cancelled' : 'running',
            startTime: operation.startTime,
            duration: Date.now() - operation.startTime,
            timeout: operation.timeout
        };
    }
    
    // 清理过期操作
    cleanupExpiredOperations() {
        const now = Date.now();
        const expiredOps = [];
        
        this.activeOperations.forEach((operation, operationId) => {
            const duration = now - operation.startTime;
            if (duration > operation.timeout + 5000) { // 超时5秒后清理
                expiredOps.push(operationId);
            }
        });
        
        expiredOps.forEach(operationId => {
            this.cancelOperation(operationId, 'Operation expired');
        });
        
        if (expiredOps.length > 0) {
            logger.info(`异步管理器: 清理了 ${expiredOps.length} 个过期操作`);
        }
    }
    
    // 获取统计信息
    getStats() {
        return {
            activeOperations: this.activeOperations.size,
            cancellationTokens: this.cancellationTokens.size,
            operationTimeouts: this.operationTimeouts.size,
            maxConcurrentOps: this.maxConcurrentOps
        };
    }
    
    // 设置最大并发数
    setMaxConcurrency(max) {
        this.maxConcurrentOps = Math.max(1, Math.min(max, 20)); // 限制在1-20之间
    }
    
    // 销毁管理器
    destroy() {
        // 取消所有操作
        this.cancelAllOperations('AsyncManager destroyed');
        
        // 清理定时器
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }
        
        // 清理所有超时
        this.operationTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
        
        // 清理映射
        this.activeOperations.clear();
        this.operationQueue.clear();
        this.cancellationTokens.clear();
        this.operationTimeouts.clear();
    }
}

// 事件监听器管理器
class EventManager {
    constructor() {
        this.listeners = new Map(); // 事件监听器映射
        this.onceListeners = new Set(); // 一次性监听器
    }
    
    // 安全添加事件监听器（防止重复）
    addEventListener(element, event, handler, options = {}) {
        const key = this.getListenerKey(element, event, handler);
        
        // 检查是否已存在
        if (this.listeners.has(key)) {
            logger.warn(`事件管理器: 监听器已存在，跳过重复绑定 ${event}`);
            return false;
        }
        
        // 添加监听器
        element.addEventListener(event, handler, options);
        this.listeners.set(key, {
            element,
            event,
            handler,
            options,
            addedAt: Date.now()
        });
        
        return true;
    }
    
    // 添加一次性监听器
    addEventListenerOnce(element, event, handler, options = {}) {
        const wrappedHandler = (...args) => {
            handler(...args);
            this.removeEventListener(element, event, wrappedHandler);
        };
        
        const key = this.getListenerKey(element, event, wrappedHandler);
        this.onceListeners.add(key);
        
        return this.addEventListener(element, event, wrappedHandler, options);
    }
    
    // 移除事件监听器
    removeEventListener(element, event, handler) {
        const key = this.getListenerKey(element, event, handler);
        const listener = this.listeners.get(key);
        
        if (listener) {
            element.removeEventListener(event, handler, listener.options);
            this.listeners.delete(key);
            this.onceListeners.delete(key);
            return true;
        }
        
        return false;
    }
    
    // 移除元素的所有监听器
    removeAllListeners(element) {
        const toRemove = [];
        
        this.listeners.forEach((listener, key) => {
            if (listener.element === element) {
                toRemove.push(key);
            }
        });
        
        toRemove.forEach(key => {
            const listener = this.listeners.get(key);
            listener.element.removeEventListener(
                listener.event, 
                listener.handler, 
                listener.options
            );
            this.listeners.delete(key);
            this.onceListeners.delete(key);
        });
        
        logger.debug(`事件管理器: 移除了元素的 ${toRemove.length} 个监听器`);
    }
    
    // 生成监听器键
    getListenerKey(element, event, handler) {
        const elementId = element.id || element.className || 'anonymous';
        const handlerName = handler.name || 'anonymous';
        return `${elementId}_${event}_${handlerName}_${handler.toString().length}`;
    }
    
    // 获取统计信息
    getStats() {
        return {
            totalListeners: this.listeners.size,
            onceListeners: this.onceListeners.size
        };
    }
    
    // 清理所有监听器
    cleanup() {
        this.listeners.forEach(listener => {
            listener.element.removeEventListener(
                listener.event,
                listener.handler,
                listener.options
            );
        });
        
        this.listeners.clear();
        this.onceListeners.clear();
    }
}

// 创建全局实例
const asyncManager = new AsyncManager();
const eventManager = new EventManager();

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { asyncManager, eventManager };
} else {
    window.asyncManager = asyncManager;
    window.eventManager = eventManager;
} 