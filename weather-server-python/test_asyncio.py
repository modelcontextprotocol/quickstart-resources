import asyncio
import time

# 模拟同步版本（会阻塞）
def sync_get_weather(city: str) -> str:
    """同步版本 - 会阻塞整个程序"""
    print(f"开始获取 {city} 的天气...")
    time.sleep(2)  # 模拟网络延迟
    print(f"完成获取 {city} 的天气")
    return f"{city}: 晴天 25°C"

# 异步版本（不阻塞）
async def async_get_weather(city: str) -> str:
    """异步版本 - 不阻塞程序"""
    print(f"开始获取 {city} 的天气...")
    await asyncio.sleep(2)  # 模拟网络延迟
    print(f"完成获取 {city} 的天气")
    return f"{city}: 晴天 25°C"

def sync_main():
    start_time = time.time()
    
    # 按顺序执行，每个都会阻塞
    weather1 = sync_get_weather("北京")
    weather2 = sync_get_weather("上海") 
    weather3 = sync_get_weather("广州")
    
    print(f"所有结果: {weather1}, {weather2}, {weather3}")
    print(f"总耗时: {time.time() - start_time:.2f}秒")

# 输出：
# 开始获取 北京 的天气...
# 完成获取 北京 的天气
# 开始获取 上海 的天气...
# 完成获取 上海 的天气
# 开始获取 广州 的天气...
# 完成获取 广州 的天气
# 所有结果: 北京: 晴天 25°C, 上海: 晴天 25°C, 广州: 晴天 25°C
# 总耗时: 6.00秒

async def async_main():
    start_time = time.time()
    
    # 方式1: 仍然按顺序等待（串行）
    weather1 = await async_get_weather("北京")
    weather2 = await async_get_weather("上海")
    weather3 = await async_get_weather("广州")
    print(f"串行结果: {weather1}, {weather2}, {weather3}")
    print(f"总耗时: {time.time() - start_time:.2f}秒")
    
    # 方式2: 并发执行（并行）
    start_time = time.time()
    results = await asyncio.gather(
        async_get_weather("北京"),
        async_get_weather("上海"), 
        async_get_weather("广州")
    )
    print(f"并发结果: {results}")
    print(f"总耗时: {time.time() - start_time:.2f}秒")

# 并发执行的输出：
# 开始获取 北京 的天气...
# 开始获取 上海 的天气...
# 开始获取 广州 的天气...
# 完成获取 北京 的天气
# 完成获取 上海 的天气
# 完成获取 广州 的天气
# 并发结果: ['北京: 晴天 25°C', '上海: 晴天 25°C', '广州: 晴天 25°C']
# 总耗时: 2.00秒

if __name__ == "__main__":
    print("=== 同步版本 ===")
    sync_main()
    
    print("\n=== 异步版本 ===")
    asyncio.run(async_main())