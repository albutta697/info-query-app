# final_review_gate.py
import sys
import os

if __name__ == "__main__":
    
    try:
        sys.stdout = os.fdopen(sys.stdout.fileno(), 'w', buffering=1)
        sys.stderr = os.fdopen(sys.stderr.fileno(), 'w', buffering=1)
    except Exception:
        pass 

    print("Review Gate: 当前步骤已完成。请输入您对【本步骤】的指令 (或输入关键字如 '完成', 'next' 来结束对本步骤的审查):", flush=True) 
    
    active_session = True
    while active_session:
        try:
            
            line = sys.stdin.readline()
            
            if not line:  # EOF
                print("--- REVIEW GATE: STDIN已关闭 (EOF), 退出脚本 ---", flush=True) 
                active_session = False
                break
            
            user_input = line.strip()
            
            user_input_lower = user_input.lower() # 英文输入转小写以便不区分大小写匹配
            
            # 结束当前步骤审查的关键字
            english_exit_keywords = [
                'task_complete', 'continue', 'next', 'end', 'complete', 'endtask', 'continue_task', 'end_task'
            ]
            chinese_exit_keywords = [
                '没问题', '继续', '下一步', '完成', '结束任务', '结束'
            ]
            
            is_exit_keyword_detected = False
            if user_input_lower in english_exit_keywords:
                is_exit_keyword_detected = True
            else:
                for ch_keyword in chinese_exit_keywords: # 中文关键字精确匹配
                    if user_input == ch_keyword:
                        is_exit_keyword_detected = True
                        break
                        
            if is_exit_keyword_detected:
                print(f"--- REVIEW GATE: 用户通过 '{user_input}' 结束了对【本步骤】的审查 ---", flush=True) 
                active_session = False
                break
            elif user_input: 
                print(f"USER_REVIEW_SUB_PROMPT: {user_input}", flush=True) # AI需要监听此格式
            
        except KeyboardInterrupt:
            print("--- REVIEW GATE: 用户通过Ctrl+C中断了【本步骤】的审查 ---", flush=True) 
            active_session = False
            break
        except Exception as e:
            print(f"--- REVIEW GATE 【本步骤】脚本错误: {e} ---", flush=True) 
            active_session = False
            break 