// DOM内存管理器
class DOMManager {
    constructor() {
        this.maxResults = 200; // 最大结果数量
        this.virtualScrollThreshold = 100; // 超过此数量启用虚拟滚动
        this.resultCache = new Map(); // 结果缓存
        this.observers = new Map(); // IntersectionObserver缓存
        
        // 绑定清理定时器
        this.setupPeriodicCleanup();
    }
    
    // 设置定期清理
    setupPeriodicCleanup() {
        // 每5分钟清理一次DOM
        this.cleanupInterval = setInterval(() => {
            this.performRoutineCleanup();
        }, 5 * 60 * 1000);
    }
    
    // 智能结果显示管理
    manageResults(container, results, createCardFunction) {
        const containerElement = typeof container === 'string' 
            ? document.getElementById(container) 
            : container;
            
        if (!containerElement) {
            console.warn('DOM管理器: 容器元素不存在');
            return;
        }
        
        // 如果结果数量超过阈值，使用虚拟滚动
        if (results.length > this.virtualScrollThreshold) {
            this.setupVirtualScroll(containerElement, results, createCardFunction);
        } else {
            this.setupNormalScroll(containerElement, results, createCardFunction);
        }
        
        // 限制最大结果数量
        this.limitResults(containerElement);
    }
    
    // 设置普通滚动（小量数据）
    setupNormalScroll(container, results, createCardFunction) {
        // 清空容器
        this.clearContainer(container);
        
        // 分批渲染，避免阻塞UI
        this.batchRender(container, results, createCardFunction, 20);
    }
    
    // 设置虚拟滚动（大量数据）
    setupVirtualScroll(container, results, createCardFunction) {
        console.log(`DOM管理器: 启用虚拟滚动，结果数量: ${results.length}`);
        
        // 清空容器并设置虚拟滚动结构
        container.innerHTML = '';
        
        const virtualContainer = document.createElement('div');
        virtualContainer.className = 'virtual-scroll-container';
        virtualContainer.style.height = '600px'; // 固定高度
        virtualContainer.style.overflowY = 'auto';
        
        const virtualContent = document.createElement('div');
        virtualContent.className = 'virtual-scroll-content';
        
        // 计算每个项目的预估高度
        const itemHeight = 120; // 每个结果卡片的预估高度
        virtualContent.style.height = `${results.length * itemHeight}px`;
        
        const viewport = document.createElement('div');
        viewport.className = 'virtual-scroll-viewport';
        
        virtualContainer.appendChild(virtualContent);
        virtualContent.appendChild(viewport);
        container.appendChild(virtualContainer);
        
        // 实现虚拟滚动逻辑
        this.setupVirtualScrollLogic(virtualContainer, viewport, results, createCardFunction, itemHeight);
    }
    
    // 虚拟滚动逻辑
    setupVirtualScrollLogic(container, viewport, results, createCardFunction, itemHeight) {
        const visibleCount = Math.ceil(container.clientHeight / itemHeight) + 2; // 多渲染2个作为缓冲
        let startIndex = 0;
        
        const renderVisibleItems = () => {
            const scrollTop = container.scrollTop;
            const newStartIndex = Math.floor(scrollTop / itemHeight);
            
            if (newStartIndex !== startIndex) {
                startIndex = newStartIndex;
                const endIndex = Math.min(startIndex + visibleCount, results.length);
                
                // 清空视口
                viewport.innerHTML = '';
                viewport.style.transform = `translateY(${startIndex * itemHeight}px)`;
                
                // 渲染可见项目
                for (let i = startIndex; i < endIndex; i++) {
                    if (results[i]) {
                        const card = createCardFunction(results[i], false);
                        viewport.appendChild(card);
                    }
                }
            }
        };
        
        // 初始渲染
        renderVisibleItems();
        
        // 监听滚动事件
        container.addEventListener('scroll', renderVisibleItems, { passive: true });
    }
    
    // 分批渲染
    batchRender(container, results, createCardFunction, batchSize = 20) {
        let index = 0;
        
        const renderBatch = () => {
            const fragment = document.createDocumentFragment();
            const end = Math.min(index + batchSize, results.length);
            
            for (let i = index; i < end; i++) {
                if (results[i]) {
                    const card = createCardFunction(results[i], false);
                    fragment.appendChild(card);
                }
            }
            
            container.appendChild(fragment);
            index = end;
            
            // 如果还有数据，继续下一批
            if (index < results.length) {
                requestAnimationFrame(renderBatch);
            }
        };
        
        renderBatch();
    }
    
    // 限制结果数量
    limitResults(container) {
        const children = container.children;
        if (children.length > this.maxResults) {
            // 移除最老的结果
            const toRemove = children.length - this.maxResults;
            for (let i = 0; i < toRemove; i++) {
                if (children[0]) {
                    children[0].remove();
                }
            }
            console.log(`DOM管理器: 已清理 ${toRemove} 个多余的结果项`);
        }
    }
    
    // 清空容器
    clearContainer(container) {
        if (container) {
            // 移除所有事件监听器
            this.removeAllEventListeners(container);
            
            // 清空内容
            container.innerHTML = '';
            
            // 强制垃圾回收（如果可用）
            if (window.gc && typeof window.gc === 'function') {
                setTimeout(() => window.gc(), 100);
            }
        }
    }
    
    // 移除所有事件监听器
    removeAllEventListeners(element) {
        if (element) {
            // 克隆元素以移除所有事件监听器
            const cloned = element.cloneNode(true);
            if (element.parentNode) {
                element.parentNode.replaceChild(cloned, element);
            }
        }
    }
    
    // 执行常规清理
    performRoutineCleanup() {
        try {
            // 清理缓存
            if (this.resultCache.size > 1000) {
                this.resultCache.clear();
                console.log('DOM管理器: 已清理结果缓存');
            }
            
            // 清理orphaned DOM节点
            this.cleanupOrphanedNodes();
            
            // 清理observers
            this.cleanupObservers();
            
        } catch (error) {
            console.warn('DOM管理器: 常规清理失败', error);
        }
    }
    
    // 清理孤立的DOM节点
    cleanupOrphanedNodes() {
        // 查找所有结果卡片，然后用JavaScript检查是否连接到DOM
        const allCards = document.querySelectorAll('.result-card');
        const orphanedCards = [];
        
        allCards.forEach(card => {
            // 使用isConnected属性检查元素是否连接到DOM
            if (!card.isConnected) {
                orphanedCards.push(card);
                card.remove();
            }
        });
        
        if (orphanedCards.length > 0) {
            console.log(`DOM管理器: 清理了 ${orphanedCards.length} 个孤立节点`);
        }
    }
    
    // 清理观察器
    cleanupObservers() {
        this.observers.forEach((observer, key) => {
            if (observer && typeof observer.disconnect === 'function') {
                observer.disconnect();
            }
        });
        this.observers.clear();
    }
    
    // 获取内存使用统计
    getMemoryStats() {
        const resultCards = document.querySelectorAll('.result-card');
        const totalElements = document.querySelectorAll('*').length;
        
        return {
            resultCards: resultCards.length,
            totalElements: totalElements,
            cacheSize: this.resultCache.size,
            maxResults: this.maxResults,
            observers: this.observers.size
        };
    }
    
    // 设置最大结果数量
    setMaxResults(max) {
        this.maxResults = Math.max(50, Math.min(max, 1000)); // 限制在50-1000之间
    }
    
    // 销毁管理器
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        
        this.cleanupObservers();
        this.resultCache.clear();
    }
}

// 创建全局DOM管理器实例
const domManager = new DOMManager();

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = domManager;
} else {
    window.domManager = domManager;
} 