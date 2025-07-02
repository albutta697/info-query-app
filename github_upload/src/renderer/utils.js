// 工具函数：标准化地址
function normalizeAddress(address) {
    if (!address) return '';

    // 转换为小写并移除多余空格
    let normalized = address.toLowerCase().replace(/\s+/g, ' ').trim();

    // 移除常见的地址后缀和单位号
    const suffixes = [
        'apt', 'apartment', 'unit', '#', 'suite', 'ste',
        'building', 'bldg', 'floor', 'fl',
        'room', 'rm', 'department', 'dept',
        'north', 'south', 'east', 'west',
        'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'
    ];

    // 移除数字+后缀组合
    normalized = normalized.replace(/(?:\s|^)(?:apt|unit|suite|ste|#)\s*[0-9a-z-]+(?:\s|$)/g, ' ');

    // 移除方向后缀
    suffixes.forEach(suffix => {
        const regex = new RegExp(`\\s${suffix}\\s|\\s${suffix}$|^${suffix}\\s`, 'g');
        normalized = normalized.replace(regex, ' ');
    });

    // 移除邮政编码
    normalized = normalized.replace(/\b\d{5}(?:-\d{4})?\b/g, '');

    // 移除多余的空格和标点
    normalized = normalized.replace(/[,\.]/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();

    return normalized;
}

// 工具函数：检查地址匹配
function addressMatches(searchAddr, resultAddr) {
    const normalizedSearch = normalizeAddress(searchAddr);
    const normalizedResult = normalizeAddress(resultAddr);

    // 完全匹配检查 (作为子字符串)
    if (normalizedResult.includes(normalizedSearch)) {
        console.log(`地址匹配成功(子字符串): ${normalizedSearch} 在 ${normalizedResult} 中找到`);
        return true;
    }

    // 分词匹配检查
    const searchWords = normalizedSearch.split(' ');
    const resultWords = normalizedResult.split(' ');

    let matchCount = 0;
    // 使用和1.js完全相同的阈值: 70%
    const minRequiredMatches = Math.ceil(searchWords.length * 0.7);

    searchWords.forEach(word => {
        if (word.length > 0 && resultWords.includes(word)) {
            matchCount++;
        }
    });

    const isMatch = matchCount >= minRequiredMatches;
    if (isMatch) {
        console.log(`地址匹配成功(分词): ${matchCount}/${searchWords.length} 词匹配，阈值: ${minRequiredMatches}`);
    }
    return isMatch;
}

// 工具函数：日期格式化
function formatDate(dateStr) {
    if (!dateStr) return '';
    console.log("尝试格式化日期:", dateStr);
    
    // 清理输入，移除除数字、斜杠和连字符外的所有字符
    const cleanInput = dateStr.replace(/[^\d\/\-]/g, '').trim();
    if (!cleanInput) return '';
    
    // 处理 YYYY-MM 或 MM-YYYY 格式
    const dashFormat = cleanInput.match(/^(\d{2,4})-(\d{1,2})$|^(\d{1,2})-(\d{2,4})$/);
    if (dashFormat) {
        const [_, part1, part2, part3, part4] = dashFormat;
        // 判断哪个部分是年份 (假设超过31的是年份)
        if (part1 && part2) {
            const isYearFirst = parseInt(part1) > 31;
            const year = isYearFirst ? part1 : part2;
            const month = isYearFirst ? part2 : part1;
            return `${month.padStart(2, '0')}/${year}`;
        } else {
            const isYearLast = parseInt(part4) > 31;
            const year = isYearLast ? part4 : part3;
            const month = isYearLast ? part3 : part4;
            return `${month.padStart(2, '0')}/${year}`;
        }
    }
    
    // 处理 MM/YYYY 或 YYYY/MM 格式
    const slashFormat = cleanInput.match(/^(\d{1,4})\/(\d{1,4})$/);
    if (slashFormat) {
        const [_, part1, part2] = slashFormat;
        // 判断哪个部分是年份 (假设超过31的是年份)
        const isYearFirst = parseInt(part1) > 31;
        const year = isYearFirst ? part1 : part2;
        const month = isYearFirst ? part2 : part1;
        return `${month.padStart(2, '0')}/${year}`;
    }
    
    // 处理 MM/DD/YYYY 格式
    const fullDateMatch = cleanInput.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (fullDateMatch) {
        const [_, month, day, year] = fullDateMatch;
        const fullYear = year.length === 2 ? `20${year}` : year;
        return `${month.padStart(2, '0')}/${day.padStart(2, '0')}/${fullYear}`;
    }
    
    // 处理纯数字格式
    const digitsOnly = cleanInput.replace(/[\/\-]/g, '');
    
    // 处理 YYYYMM 或 MMYYYY 格式 (6位数字)
    if (digitsOnly.length === 6) {
        // 判断前两位或后两位是否为合法月份 (01-12)
        const firstTwo = digitsOnly.substring(0, 2);
        const lastTwo = digitsOnly.substring(4, 6);
        
        if (parseInt(firstTwo) >= 1 && parseInt(firstTwo) <= 12) {
            // 可能是 MMYYYY 格式
            const month = firstTwo;
            const year = digitsOnly.substring(2);
            return `${month}/${year}`;
        } else if (parseInt(lastTwo) >= 1 && parseInt(lastTwo) <= 12) {
            // 可能是 YYYYMM 格式
            const year = digitsOnly.substring(0, 4);
            const month = lastTwo;
            return `${month}/${year}`;
        } else {
            // 如果都不是有效月份，假设是 YYYYMM 格式
            const year = digitsOnly.substring(0, 4);
            const month = digitsOnly.substring(4, 6);
            return `${month}/${year}`;
        }
    }
    
    // 处理 YYYYMMDD 格式 (8位数字)
    if (digitsOnly.length === 8) {
        const year = digitsOnly.substring(0, 4);
        const month = digitsOnly.substring(4, 6);
        const day = digitsOnly.substring(6, 8);
        return `${month}/${day}/${year}`;
    }
    
    // 处理 YYYY 格式 (4位数字年份)
    if (digitsOnly.length === 4 && parseInt(digitsOnly) >= 1900 && parseInt(digitsOnly) <= 2100) {
        // 假定是年份，不知道月份时，默认使用01作为月份
        return `01/${digitsOnly}`;
    }
    
    // 处理 YY 格式 (2位数字年份)
    if (digitsOnly.length === 2 && parseInt(digitsOnly) >= 0 && parseInt(digitsOnly) <= 99) {
        // 假定是年份，为2000年代，默认使用01作为月份
        const fullYear = parseInt(digitsOnly) <= 30 ? `20${digitsOnly}` : `19${digitsOnly}`;
        return `01/${fullYear}`;
    }
    
    // 处理 MM 格式 (1-2位数字月份)
    if (digitsOnly.length <= 2 && parseInt(digitsOnly) >= 1 && parseInt(digitsOnly) <= 12) {
        // 假定是月份，不知道年份时返回格式化的月份
        const currentYear = new Date().getFullYear();
        return `${digitsOnly.padStart(2, '0')}/${currentYear}`;
    }
    
    // 特殊情况：如果是类似"9/1959"的格式
    if (dateStr.match(/^\d{1,2}\/\d{4}$/)) {
        const parts = dateStr.split('/');
        return `${parts[0].padStart(2, '0')}/${parts[1]}`;
    }
    
    // 特殊情况：处理类似"59"或"09"这样可能表示年份的短格式
    if (digitsOnly.length === 2) {
        const year = parseInt(digitsOnly) <= 30 ? `20${digitsOnly}` : `19${digitsOnly}`;
        return `01/${year}`;
    }
    
    // 单个数字，假设是月份
    if (digitsOnly.length === 1) {
        const currentYear = new Date().getFullYear();
        return `0${digitsOnly}/${currentYear}`;
    }
    
    // 如果无法识别格式，尝试作为正常日期解析
    try {
        const date = new Date(cleanInput);
        if (!isNaN(date.getTime())) {
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const day = date.getDate().toString().padStart(2, '0');
            const year = date.getFullYear();
            return `${month}/${day}/${year}`;
        }
    } catch (e) {
        console.log("日期解析错误:", e);
    }
    
    console.log("无法识别的日期格式:", dateStr, "返回原始字符串");
    return dateStr; // 如果无法识别格式，返回原始字符串
}

// 工具函数：获取日期的年月
function getYearMonth(dateStr) {
    if (!dateStr) return '';

    // 清理输入，移除除数字、斜杠和连字符外的所有字符
    const cleanInput = dateStr.replace(/[^\d\/\-]/g, '').trim();
    if (!cleanInput) return '';
    
    // 处理 MM/DD/YYYY 格式
    const fullDateMatch = cleanInput.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (fullDateMatch) {
        const [_, month, day, year] = fullDateMatch;
        const fullYear = year.length === 2 ? `20${year}` : year;
        return `${fullYear}${month.padStart(2, '0')}`; // YYYYMM格式
    }
    
    // 处理 MM/YYYY 格式
    const monthYearMatch = cleanInput.match(/^(\d{1,2})\/(\d{4})$/);
    if (monthYearMatch) {
        const [_, month, year] = monthYearMatch;
        return `${year}${month.padStart(2, '0')}`; // YYYYMM格式
    }
    
    // 处理 YYYY/MM 格式
    const yearMonthMatch = cleanInput.match(/^(\d{4})\/(\d{1,2})$/);
    if (yearMonthMatch) {
        const [_, year, month] = yearMonthMatch;
        return `${year}${month.padStart(2, '0')}`; // YYYYMM格式
    }
    
    // 处理 YYYY-MM 格式
    const yearMonthDashMatch = cleanInput.match(/^(\d{4})-(\d{1,2})$/);
    if (yearMonthDashMatch) {
        const [_, year, month] = yearMonthDashMatch;
        return `${year}${month.padStart(2, '0')}`; // YYYYMM格式
    }
    
    // 处理 MM-YYYY 格式
    const monthYearDashMatch = cleanInput.match(/^(\d{1,2})-(\d{4})$/);
    if (monthYearDashMatch) {
        const [_, month, year] = monthYearDashMatch;
        return `${year}${month.padStart(2, '0')}`; // YYYYMM格式
    }
    
    // 尝试从标准化的日期格式中提取年月
    // 大多数情况下，formatDate已经将日期转换为MM/DD/YYYY或MM/YYYY格式
    const parts = cleanInput.split('/');
    
    if (parts.length === 3) {
        // MM/DD/YYYY 格式
        const month = parts[0];
        const year = parts[2];
        return `${year}${month.padStart(2, '0')}`;
    } else if (parts.length === 2) {
        // 检查哪个是年份 (通常年份更大)
        const part1 = parseInt(parts[0]);
        const part2 = parseInt(parts[1]);
        
        if (part1 > 31 && part1 >= 1900 && part1 <= 2100) {
            // 第一部分是年份，第二部分是月份
            return `${parts[0]}${parts[1].padStart(2, '0')}`;
        } else if (part2 > 31 && part2 >= 1900 && part2 <= 2100) {
            // 第二部分是年份，第一部分是月份
            return `${parts[1]}${parts[0].padStart(2, '0')}`;
        }
    }
    
    // 处理纯数字格式
    const digitsOnly = cleanInput.replace(/[\/\-]/g, '');
    
    // 处理 YYYYMM 或 MMYYYY 格式 (6位数字)
    if (digitsOnly.length === 6) {
        // 判断前四位是否为可能的年份 (1900-2100)
        const firstFour = parseInt(digitsOnly.substring(0, 4));
        if (firstFour >= 1900 && firstFour <= 2100) {
            // 可能是 YYYYMM 格式
            return digitsOnly;
        } else {
            // 可能是 MMYYYY 格式
            const month = digitsOnly.substring(0, 2);
            const year = digitsOnly.substring(2);
            return `${year}${month}`;
        }
    }
    
    // 处理 YYYY 格式 (4位数字年份)
    if (digitsOnly.length === 4 && parseInt(digitsOnly) >= 1900 && parseInt(digitsOnly) <= 2100) {
        // 对于仅有年份的情况，返回年份+"01"作为标准化格式
        return `${digitsOnly}01`;
    }
    
    // 处理 MM 格式 (1-2位数字月份)
    if (digitsOnly.length <= 2 && parseInt(digitsOnly) >= 1 && parseInt(digitsOnly) <= 12) {
        // 对于仅有月份的情况，使用当前年份
        const currentYear = new Date().getFullYear();
        return `${currentYear}${digitsOnly.padStart(2, '0')}`;
    }
    
    // 尝试使用Date对象解析
    try {
        const date = new Date(cleanInput);
        if (!isNaN(date.getTime())) {
            const year = date.getFullYear();
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            return `${year}${month}`;
        }
    } catch (e) {
        console.log("年月解析错误:", e);
    }

    return '';
}

// 工具函数：比较两个日期的年月
function compareYearMonth(date1, date2) {
    const ym1 = getYearMonth(date1);
    const ym2 = getYearMonth(date2);

    if (!ym1 && !ym2) return 0;
    if (!ym1) return 1;
    if (!ym2) return -1;

    return ym1.localeCompare(ym2);
}

// 工具函数：检查两个日期是否匹配（年月相同）
function isDateMatch(date1, date2) {
    const ym1 = getYearMonth(date1);
    const ym2 = getYearMonth(date2);
    const result = ym1 && ym2 && ym1 === ym2;
    if (result) {
        console.log(`日期匹配成功: ${date1} 与 ${date2} (年月: ${ym1})`);
    }
    return result;
}

// 工具函数：复制到剪贴板
function copyToClipboard(text) {
    return new Promise((resolve) => {
        if (!text) {
            resolve(false);
            return;
        }
        
        try {
            // 使用Electron的clipboard API
            const { clipboard } = require('electron');
            clipboard.writeText(text);
            resolve(true);
        } catch (err) {
            console.error('使用Electron clipboard失败，尝试DOM方法', err);
            
            // 回退到DOM方法
            try {
                // 创建临时文本区域
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                document.body.appendChild(textarea);

                // 选择文本
                textarea.select();
                textarea.setSelectionRange(0, 99999);
                
                // 执行复制
                const success = document.execCommand('copy');
                document.body.removeChild(textarea);
                resolve(success);
            } catch (domErr) {
                console.error('复制失败:', domErr);
                resolve(false);
            }
        }
    });
}

// 工具函数：延迟执行
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 工具函数：可中断的延迟执行 - 优化为快速响应取消信号
function interruptibleDelay(ms) {
    return new Promise((resolve, reject) => {
        const checkInterval = 10; // 每10ms检查一次，提高响应速度
        const iterations = Math.ceil(ms / checkInterval);
        let currentIteration = 0;
        
        const intervalId = setInterval(() => {
            // 检查全局取消标志
            if (window.globalShouldStop) {
                clearInterval(intervalId);
                reject(new Error('Operation cancelled'));
                return;
            }
            
            currentIteration++;
            if (currentIteration >= iterations) {
                clearInterval(intervalId);
                resolve();
            }
        }, checkInterval);
        
        // 立即检查一次取消标志，避免延迟
        if (window.globalShouldStop) {
            clearInterval(intervalId);
            reject(new Error('Operation cancelled'));
        }
    });
}

// 工具函数：创建可取消的Promise
function makeCancellable(promise) {
    let hasCancelled = false;
    
    const wrappedPromise = new Promise((resolve, reject) => {
        promise.then(
            value => hasCancelled ? reject(new Error('Operation cancelled')) : resolve(value),
            error => hasCancelled ? reject(new Error('Operation cancelled')) : reject(error)
        );
    });
    
    return {
        promise: wrappedPromise,
        cancel() {
            hasCancelled = true;
        }
    };
}

// 工具函数：带取消检查的Promise.all
async function cancellablePromiseAll(promises, checkCancelFn) {
    const results = [];
    const errors = [];
    
    // 创建可取消的promise包装器
    const cancellablePromises = promises.map(p => makeCancellable(p));
    
    // 创建一个检查取消的Promise
    const cancelChecker = new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
            if (checkCancelFn()) {
                clearInterval(checkInterval);
                // 取消所有正在进行的promises
                cancellablePromises.forEach(cp => cp.cancel());
                reject(new Error('Operation cancelled'));
            }
        }, 100);
        
        // 当所有promises完成时清理interval
        Promise.allSettled(cancellablePromises.map(cp => cp.promise)).then(() => {
            clearInterval(checkInterval);
            resolve();
        });
    });
    
    try {
        // 等待所有promises完成或被取消
        await Promise.race([
            cancelChecker,
            Promise.allSettled(cancellablePromises.map(cp => cp.promise))
        ]);
        
        // 如果没有被取消，收集结果
        const settledResults = await Promise.allSettled(cancellablePromises.map(cp => cp.promise));
        
        for (let i = 0; i < settledResults.length; i++) {
            const result = settledResults[i];
            if (result.status === 'fulfilled') {
                results.push(result.value);
            } else {
                errors.push(result.reason);
            }
        }
        
        return { results, errors, cancelled: false };
    } catch (error) {
        if (error.message === 'Operation cancelled') {
            return { results: [], errors: [], cancelled: true };
        }
        throw error;
    }
}

// 工具函数：获取州代码
function getStateCode(stateInput) {
    const stateMap = {
        'AL': ['AL', 'ALABAMA', '阿拉巴马'],
        'AK': ['AK', 'ALASKA', '阿拉斯加'],
        'AZ': ['AZ', 'ARIZONA', '亚利桑那'],
        'AR': ['AR', 'ARKANSAS', '阿肯色'],
        'CA': ['CA', 'CALIFORNIA', '加利福尼亚'],
        'CO': ['CO', 'COLORADO', '科罗拉多'],
        'CT': ['CT', 'CONNECTICUT', '康涅狄格'],
        'DE': ['DE', 'DELAWARE', '特拉华'],
        'FL': ['FL', 'FLORIDA', '佛罗里达'],
        'GA': ['GA', 'GEORGIA', '乔治亚'],
        'HI': ['HI', 'HAWAII', '夏威夷'],
        'ID': ['ID', 'IDAHO', '爱达荷'],
        'IL': ['IL', 'ILLINOIS', '伊利诺伊'],
        'IN': ['IN', 'INDIANA', '印第安纳'],
        'IA': ['IA', 'IOWA', '艾奥瓦'],
        'KS': ['KS', 'KANSAS', '堪萨斯'],
        'KY': ['KY', 'KENTUCKY', '肯塔基'],
        'LA': ['LA', 'LOUISIANA', '路易斯安那'],
        'ME': ['ME', 'MAINE', '缅因'],
        'MD': ['MD', 'MARYLAND', '马里兰'],
        'MA': ['MA', 'MASSACHUSETTS', '马萨诸塞'],
        'MI': ['MI', 'MICHIGAN', '密歇根'],
        'MN': ['MN', 'MINNESOTA', '明尼苏达'],
        'MS': ['MS', 'MISSISSIPPI', '密西西比'],
        'MO': ['MO', 'MISSOURI', '密苏里'],
        'MT': ['MT', 'MONTANA', '蒙大拿'],
        'NE': ['NE', 'NEBRASKA', '内布拉斯加'],
        'NV': ['NV', 'NEVADA', '内华达'],
        'NH': ['NH', 'NEW HAMPSHIRE', '新罕布什尔'],
        'NJ': ['NJ', 'NEW JERSEY', '新泽西'],
        'NM': ['NM', 'NEW MEXICO', '新墨西哥'],
        'NY': ['NY', 'NEW YORK', '纽约'],
        'NC': ['NC', 'NORTH CAROLINA', '北卡罗来纳'],
        'ND': ['ND', 'NORTH DAKOTA', '北达科他'],
        'OH': ['OH', 'OHIO', '俄亥俄'],
        'OK': ['OK', 'OKLAHOMA', '俄克拉荷马'],
        'OR': ['OR', 'OREGON', '俄勒冈'],
        'PA': ['PA', 'PENNSYLVANIA', '宾夕法尼亚'],
        'RI': ['RI', 'RHODE ISLAND', '罗德岛'],
        'SC': ['SC', 'SOUTH CAROLINA', '南卡罗来纳'],
        'SD': ['SD', 'SOUTH DAKOTA', '南达科他'],
        'TN': ['TN', 'TENNESSEE', '田纳西'],
        'TX': ['TX', 'TEXAS', '得克萨斯'],
        'UT': ['UT', 'UTAH', '犹他'],
        'VT': ['VT', 'VERMONT', '佛蒙特'],
        'VA': ['VA', 'VIRGINIA', '弗吉尼亚'],
        'WA': ['WA', 'WASHINGTON', '华盛顿'],
        'WV': ['WV', 'WEST VIRGINIA', '西弗吉尼亚'],
        'WI': ['WI', 'WISCONSIN', '威斯康星'],
        'WY': ['WY', 'WYOMING', '怀俄明']
    };

    const input = stateInput.trim().toUpperCase();

    // 检查是否是邮编
    if (/^\d{5}(-\d{4})?$/.test(input)) {
        return { isZip: true, value: input };
    }

    // 查找州代码
    for (const [code, aliases] of Object.entries(stateMap)) {
        if (aliases.some(alias => alias.toUpperCase() === input)) {
            return { isZip: false, value: code };
        }
    }

    // 如果找不到匹配的州代码，返回原始输入
    return { isZip: false, value: input };
}

// 工具函数：结果去重
function removeDuplicateResults(results) {
    const seen = new Set();
    return results.filter(result => {
        // 创建唯一标识（使用SSN和DOB组合）
        const key = `${result.ssn}_${result.dob}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

// 测试日期格式自动检测和转换的辅助函数
function testDateFormat(dateStr) {
    if (!dateStr) return '无效日期输入';
    
    try {
        const formattedDate = formatDate(dateStr);
        const yearMonth = getYearMonth(formattedDate);
        
        return {
            原始输入: dateStr,
            标准化格式: formattedDate,
            年月提取结果: yearMonth,
            年: yearMonth.substring(0, 4) || '未识别',
            月: yearMonth.length >= 6 ? yearMonth.substring(4, 6) : '未识别'
        };
    } catch (error) {
        console.error('日期格式测试错误:', error);
        return {
            原始输入: dateStr,
            错误: '日期解析失败',
            详情: error.message
        };
    }
}

/**
 * 检测日期字符串的格式
 * @param {string} dateString - 日期字符串
 * @returns {string} 检测到的日期格式描述
 */
function detectDateFormat(dateString) {
    if (!dateString) return '';
    
    // 移除所有空白字符
    const date = dateString.trim();
    
    // 检查标准日期格式
    if (date.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
        return 'MM/DD/YYYY';
    }
    
    if (date.match(/^\d{1,2}\/\d{4}$/)) {
        return 'MM/YYYY';
    }
    
    if (date.match(/^\d{4}\/\d{1,2}$/)) {
        return 'YYYY/MM';
    }
    
    if (date.match(/^\d{1,2}-\d{4}$/)) {
        return 'MM-YYYY';
    }
    
    if (date.match(/^\d{4}-\d{1,2}$/)) {
        return 'YYYY-MM';
    }
    
    if (date.match(/^\d{8}$/)) {
        return 'YYYYMMDD';
    }
    
    if (date.match(/^\d{6}$/)) {
        // 通过检查前两位确定是YYYYMM还是MMYYYY
        const firstTwo = parseInt(date.substring(0, 2));
        if (firstTwo >= 1 && firstTwo <= 12) {
            // 可能是MMYYYY
            const lastFour = parseInt(date.substring(2));
            if (lastFour >= 1900 && lastFour <= 2100) {
                return 'MMYYYY';
            }
        }
        
        // 假设是YYYYMM
        const firstFour = parseInt(date.substring(0, 4));
        if (firstFour >= 1900 && firstFour <= 2100) {
            const lastTwo = parseInt(date.substring(4));
            if (lastTwo >= 1 && lastTwo <= 12) {
                return 'YYYYMM';
            }
        }
        
        return '未识别的6位数字格式';
    }
    
    if (date.match(/^\d{4}$/)) {
        return 'YYYY (年份)';
    }
    
    if (date.match(/^\d{1,2}$/)) {
        const num = parseInt(date);
        if (num >= 1 && num <= 12) {
            return 'MM (月份)';
        }
    }
    
    return '未知格式';
}

// 更健壮的等待表格内容变化/出现的工具函数
async function waitForTableContentChangeOrAppear(page, oldRows = null, timeout = 10000) {
    console.log('waitForTableContentChangeOrAppear 开始执行', {
        hasOldRows: !!oldRows && Array.isArray(oldRows) && oldRows.length > 0,
        oldRowsCount: Array.isArray(oldRows) ? oldRows.length : 0,
        timeout
    });
    
    // 检查页面是否有效
    if (!page) {
        console.error('waitForTableContentChangeOrAppear 错误: 页面对象为空');
        throw new Error('页面对象为空');
    }
    
    // 检查页面是否已关闭
    let isClosed = false;
    try {
        isClosed = page.isClosed();
    } catch (checkError) {
        console.error('检查页面是否关闭时出错:', checkError);
        // 假设页面可能已关闭
        throw new Error('页面状态检查失败，可能已关闭');
    }
    
    if (isClosed) {
        console.error('waitForTableContentChangeOrAppear 错误: 页面已关闭');
        throw new Error('页面已关闭');
    }
    
    try {
        const start = Date.now();
        
        // 【优化】如果有旧行数据，说明是翻页操作，先等待一定时间让页面稳定
        if (oldRows && Array.isArray(oldRows) && oldRows.length > 0) {
            console.log('检测到翻页操作，等待页面稳定...');
            try {
                await new Promise(res => setTimeout(res, 800)); // 等待800ms让页面稳定
            } catch (error) {
                // 检查是否被取消
                if (window.globalShouldStop) {
                    console.log('等待页面稳定时被取消');
                    throw new Error('Operation cancelled');
                }
            }
        }
        
        // 先等待表格出现（最多2秒）
        let tableAppeared = false;
        console.log('等待表格元素出现...');
        
        while (Date.now() - start < Math.min(timeout, 2000)) {
            // 检查取消标志
            if (window.globalShouldStop) {
                console.log('waitForTableContentChangeOrAppear 被取消');
                throw new Error('Operation cancelled');
            }
            
            try {
                const exists = await page.evaluate(() => {
                    try {
                        const tableRows = document.querySelectorAll('.n-data-table-tr');
                        return tableRows && tableRows.length > 0;
                    } catch (innerError) {
                        console.error('检查表格行时出错:', innerError);
                        return false;
                    }
                });
                
                if (exists) {
                    tableAppeared = true;
                    console.log('表格元素已出现');
                    break;
                }
            } catch (evalError) {
                console.error('检查表格是否存在时出错:', evalError);
                // 如果页面已关闭或导航离开，则抛出错误
                if (evalError.message.includes('Target closed') || 
                    evalError.message.includes('Navigation failed') ||
                    evalError.message.includes('Execution context was destroyed')) {
                    throw new Error(`页面已关闭或导航离开: ${evalError.message}`);
                }
                // 其他错误继续尝试
            }
            
            await new Promise(res => setTimeout(res, 200)); // 【优化】从100ms增加到200ms
        }
        
        if (!tableAppeared) {
            console.log('表格元素在初始等待期内未出现，但将继续等待内容变化');
        }
        
        // 再等待内容变化
        const base = Date.now();
        let firstRows = oldRows;
        
        // 如果没有提供旧行数据，获取当前表格内容作为基准
        if (!firstRows || !Array.isArray(firstRows) || firstRows.length === 0) {
            try {
                firstRows = await page.evaluate(() => {
                    try {
                        const rows = document.querySelectorAll('.n-data-table-tr');
                        if (!rows || rows.length === 0) {
                            return [];
                        }
                        return Array.from(rows).map(r => r.innerText || '');
                    } catch (innerError) {
                        console.error('获取表格行内容时出错:', innerError);
                        return [];
                    }
                });
                console.log(`获取到初始表格内容: ${firstRows.length} 行`);
            } catch (evalError) {
                console.error('获取初始表格内容时出错:', evalError);
                // 如果页面已关闭，则抛出错误
                if (evalError.message.includes('Target closed') || 
                    evalError.message.includes('Execution context was destroyed')) {
                    throw new Error(`获取初始表格内容时页面已关闭: ${evalError.message}`);
                }
                // 其他错误则使用空数组作为基准
                firstRows = [];
            }
        }
        
        // 监控表格内容变化
        console.log('开始监控表格内容变化...');
        let attempts = 0;
        
        // 创建取消检查Promise - 【优化】降低检查频率
        const cancelChecker = new Promise((resolve, reject) => {
            const checkInterval = setInterval(() => {
                if (window.globalShouldStop) {
                    clearInterval(checkInterval);
                    reject(new Error('Operation cancelled'));
                }
            }, 100); // 【优化】从10ms增加到100ms，减少CPU占用
        });
        
        // 创建内容变化检测Promise
        const contentChangeDetector = new Promise(async (resolve, reject) => {
            try {
                while (Date.now() - base < timeout) {
                    attempts++;
                    
                    // 快速取消检查
                    if (window.globalShouldStop) {
                        reject(new Error('Operation cancelled'));
                        return;
                    }
                    
                    try {
                        // 再次检查页面是否已关闭
                        try {
                            isClosed = page.isClosed();
                            if (isClosed) {
                                reject(new Error('页面已关闭'));
                                return;
                            }
                        } catch (checkError) {
                            console.error('监控过程中检查页面是否关闭时出错:', checkError);
                            reject(new Error('页面状态检查失败，可能已关闭'));
                            return;
                        }
                        
                        const newRows = await page.evaluate(() => {
                            try {
                                const rows = document.querySelectorAll('.n-data-table-tr');
                                if (!rows) return [];
                                return Array.from(rows).map(r => r.innerText || '');
                            } catch (innerError) {
                                console.error('获取新表格行内容时出错:', innerError);
                                return [];
                            }
                        });
                        
                        // 【优化】减少日志频率
                        if (attempts % 3 === 0) { // 从每5次改为每3次检查记录一次
                            console.log(`第 ${attempts} 次检查表格内容, 当前行数: ${newRows.length}`);
                        }
                        
                        // 安全比较两个数组
                        let contentChanged = false;
                        
                        // 检查行数是否变化
                        if ((!firstRows || firstRows.length === 0) && newRows.length > 0) {
                            contentChanged = true;
                        } else if ((firstRows && firstRows.length > 0) && newRows.length === 0) {
                            contentChanged = true;
                        } else if (firstRows.length !== newRows.length) {
                            contentChanged = true;
                        } else {
                            // 行数相同，检查内容
                            try {
                                contentChanged = JSON.stringify(newRows) !== JSON.stringify(firstRows);
                            } catch (compareError) {
                                console.error('比较表格内容时出错:', compareError);
                                // 如果无法比较，假设内容已变化
                                contentChanged = true;
                            }
                        }
                        
                        if (contentChanged) {
                            console.log(`✅ 表格内容已变化: 从 ${firstRows.length} 行变为 ${newRows.length} 行`);
                            resolve(newRows);
                            return;
                        }
                    } catch (evalError) {
                        console.error(`第 ${attempts} 次检查表格内容时出错:`, evalError);
                        // 如果页面已关闭，则抛出错误
                        if (evalError.message.includes('Target closed') || 
                            evalError.message.includes('Execution context was destroyed')) {
                            reject(new Error(`检查表格内容时页面已关闭: ${evalError.message}`));
                            return;
                        }
                        // 其他错误继续尝试
                    }
            
                    // 【优化】显著增加检查间隔，从50ms增加到1000ms（1秒）
                    await new Promise(res => setTimeout(res, 1000));
                }
                
                reject(new Error('等待表格内容变化或出现超时'));
            } catch (error) {
                reject(error);
            }
        });
        
        // 使用Promise.race确保取消信号能立即胜出
        try {
            return await Promise.race([cancelChecker, contentChangeDetector]);
        } catch (error) {
            if (error.message === 'Operation cancelled') {
                console.log('waitForTableContentChangeOrAppear 被立即取消');
            } else {
                console.warn(`等待表格内容变化超时: ${timeout}ms 内未检测到变化`);
            }
            throw error;
        }
    } catch (error) {
        // 记录详细错误信息
        console.error('waitForTableContentChangeOrAppear 失败:', {
            message: error.message,
            name: error.name,
            stack: error.stack,
            time: new Date().toISOString()
        });
        
        // 重新抛出错误，保持原始错误信息
        throw error;
    }
}

// 高级等待表格内容变化 - 基于高级检测器的改进版本
async function waitForTableContentChangeOrAppearAdvanced(page, oldRows = null, timeout = 10000) {
    console.log('[高级等待] waitForTableContentChangeOrAppearAdvanced 开始执行', {
        hasOldRows: !!oldRows && Array.isArray(oldRows) && oldRows.length > 0,
        oldRowsCount: Array.isArray(oldRows) ? oldRows.length : 0,
        timeout
    });
    
    // 检查页面是否有效
    if (!page) {
        console.error('[高级等待] 页面对象为空');
        throw new Error('页面对象为空');
    }
    
    // 检查页面是否已关闭
    let isClosed = false;
    try {
        isClosed = page.isClosed();
    } catch (checkError) {
        console.error('[高级等待] 检查页面是否关闭时出错:', checkError);
        throw new Error('页面状态检查失败，可能已关闭');
    }
    
    if (isClosed) {
        console.error('[高级等待] 页面已关闭');
        throw new Error('页面已关闭');
    }
    
    try {
        // 使用高级检测器
        const AdvancedDetector = require('./advanced-detector');
        const detector = new AdvancedDetector();
        
        const start = Date.now();
        
        // 如果有旧行数据，说明是翻页操作
        if (oldRows && Array.isArray(oldRows) && oldRows.length > 0) {
            console.log('[高级等待] 检测到翻页操作，使用高级翻页等待...');
            const pageChangeResult = await detector.waitForPageChange(page, null, timeout);
            
            if (pageChangeResult.success) {
                console.log('[高级等待] ✅ 翻页完成:', pageChangeResult);
                return await page.evaluate(() => {
                    try {
                        const rows = document.querySelectorAll('.n-data-table-tr');
                        return Array.from(rows).map(r => r.innerText || '');
                    } catch (error) {
                        return [];
                    }
                });
            } else {
                console.log('[高级等待] ⚠️ 翻页等待失败:', pageChangeResult);
                throw new Error(`翻页等待失败: ${pageChangeResult.reason}`);
            }
        } else {
            console.log('[高级等待] 使用高级查询等待...');
            const queryResult = await detector.waitForQueryComplete(page, timeout);
            
            if (queryResult.success) {
                console.log('[高级等待] ✅ 查询完成:', queryResult);
                return await page.evaluate(() => {
                    try {
                        const rows = document.querySelectorAll('.n-data-table-tr');
                        return Array.from(rows).map(r => r.innerText || '');
                    } catch (error) {
                        return [];
                    }
                });
            } else {
                console.log('[高级等待] ⚠️ 查询等待失败:', queryResult);
                // 查询等待失败时，回退到原有方法
                console.log('[高级等待] 回退到原有等待方法...');
                return await waitForTableContentChangeOrAppear(page, oldRows, timeout);
            }
        }
        
    } catch (error) {
        console.error('[高级等待] 失败:', error);
        
        // 如果高级等待失败，回退到原有方法
        if (error.message !== 'Operation cancelled') {
            console.log('[高级等待] 回退到原有等待方法...');
            try {
                return await waitForTableContentChangeOrAppear(page, oldRows, timeout);
            } catch (fallbackError) {
                console.error('[高级等待] 回退方法也失败:', fallbackError);
                throw fallbackError;
            }
        } else {
            throw error;
        }
    }
}

// 导出函数
module.exports = {
    normalizeAddress,
    addressMatches,
    formatDate,
    getYearMonth,
    compareYearMonth,
    isDateMatch,
    copyToClipboard,
    delay,
    interruptibleDelay,
    makeCancellable,
    cancellablePromiseAll,
    getStateCode,
    removeDuplicateResults,
    testDateFormat,
    detectDateFormat,
    waitForTableContentChangeOrAppear,
    waitForTableContentChangeOrAppearAdvanced
}; 