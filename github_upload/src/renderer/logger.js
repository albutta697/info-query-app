// 统一日志管理器
class Logger {
    constructor() {
        this.level = this.getLogLevel();
        this.errorCache = new Map(); // 缓存错误，避免重复输出
        this.maxCacheSize = 100;
        this.errorThrottleTime = 5000; // 5秒内相同错误只输出一次
    }
    
    // 获取日志级别（可通过localStorage配置）
    getLogLevel() {
        const savedLevel = localStorage.getItem('appLogLevel');
        return savedLevel || 'INFO'; // DEBUG, INFO, WARN, ERROR
    }
    
    // 设置日志级别
    setLogLevel(level) {
        this.level = level;
        localStorage.setItem('appLogLevel', level);
    }
    
    // 获取当前时间戳
    getTimestamp() {
        return new Date().toISOString().substr(11, 12);
    }
    
    // 检查是否应该输出该级别的日志
    shouldLog(level) {
        const levels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
        return levels[level] >= levels[this.level];
    }
    
    // 检查错误是否应该被输出（防止重复）
    shouldLogError(message, context = '') {
        const key = `${message}_${context}`;
        const now = Date.now();
        
        if (this.errorCache.has(key)) {
            const lastTime = this.errorCache.get(key);
            if (now - lastTime < this.errorThrottleTime) {
                return false; // 在阈值时间内，不重复输出
            }
        }
        
        // 清理过期的缓存
        if (this.errorCache.size > this.maxCacheSize) {
            const oldestKey = this.errorCache.keys().next().value;
            this.errorCache.delete(oldestKey);
        }
        
        this.errorCache.set(key, now);
        return true;
    }
    
    // Debug级别日志
    debug(message, ...args) {
        if (this.shouldLog('DEBUG')) {
            console.log(`🔍 [${this.getTimestamp()}] ${message}`, ...args);
        }
    }
    
    // Info级别日志  
    info(message, ...args) {
        if (this.shouldLog('INFO')) {
            console.log(`ℹ️ [${this.getTimestamp()}] ${message}`, ...args);
        }
    }
    
    // Warning级别日志
    warn(message, ...args) {
        if (this.shouldLog('WARN')) {
            console.warn(`⚠️ [${this.getTimestamp()}] ${message}`, ...args);
        }
    }
    
    // Error级别日志（支持去重）
    error(message, context = '', ...args) {
        if (this.shouldLog('ERROR') && this.shouldLogError(message, context)) {
            console.error(`❌ [${this.getTimestamp()}] ${message}`, ...args);
        }
    }
    
    // 严重错误（总是输出）
    critical(message, ...args) {
        console.error(`🚨 [${this.getTimestamp()}] CRITICAL: ${message}`, ...args);
    }
    
    // 性能日志
    perf(operation, startTime, ...args) {
        if (this.shouldLog('DEBUG')) {
            const duration = Date.now() - startTime;
            console.log(`⏱️ [${this.getTimestamp()}] ${operation} 耗时: ${duration}ms`, ...args);
        }
    }
    
    // 查询相关日志
    query(message, ...args) {
        if (this.shouldLog('INFO')) {
            console.log(`🔍 [${this.getTimestamp()}] QUERY: ${message}`, ...args);
        }
    }
    
    // 内存相关日志
    memory(message, ...args) {
        if (this.shouldLog('DEBUG')) {
            console.log(`💾 [${this.getTimestamp()}] MEMORY: ${message}`, ...args);
        }
    }
    
    // 清理错误缓存
    clearErrorCache() {
        this.errorCache.clear();
    }
    
    // 获取错误统计
    getErrorStats() {
        return {
            cachedErrors: this.errorCache.size,
            maxCacheSize: this.maxCacheSize,
            throttleTime: this.errorThrottleTime
        };
    }
}

// 创建全局日志实例
const logger = new Logger();

// 导出日志实例
if (typeof module !== 'undefined' && module.exports) {
    module.exports = logger;
} else {
    window.logger = logger;
} 