import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from typing import List, Optional, Any
from langchain.callbacks.manager import CallbackManagerForLLMRun
from langchain.llms.base import LLM
from langchain.prompts import ChatPromptTemplate
import uuid
import json
import requests


class Hunyuan(LLM):

    def __init__(self):
        super().__init__()
        print("construct hunyuan")

    def _call(self,
              prompt: ChatPromptTemplate
              ) -> str:
        messages = [
            {"role": "user", "content": prompt.messages[0].content}
        ]
        response = self.venus_completion(messages)
        # print(response)
        return response['content']

    def call(self,
             messages: List[dict],
             stop: Optional[List[str]] = None,
             callbacks: Optional[CallbackManagerForLLMRun] = None,
             **kwargs: Any,
             ) -> str:
        response = self.venus_completion(messages)
        # print(response)
        return response

    def _llm_type(self) -> str:
        return "venus"

    # def venus_completion(self,messages:List[dict]) -> str:
    #     secret_id = "uJjku398bgsmxmGC1ouBDN9H"
    #     secret_key = "6yThEz3mmauEdZ2mwuB5Yzl0"

    #     client = HttpClient(config=Config(), secret_id=secret_id, secret_key=secret_key)

    #     header = {
    #         "Content-Type": "application/json",
    #     }

    #     body = {
    #         # 需要替换成自己的 appGroupId
    #         "appGroupId": 3025,
    #         # 指定服务
    #         "serverId": 232016,
    #         # 不用自定义上下文
    #         # "request": prompt,
    #         # 自定义上下文
    #         "messages": messages,
    #         "temperature": 0.2,
    #         "top_p": 1,
    #         "max_tokens": 1000,
    #     }
    #     ret = client.post(
    #         "http://v2.open.venus.oa.com/chat/single", header=header, body=json.dumps(body)
    #     )
    #     return ret["data"]["response"]

    def venus_completion(self, messages: List[dict]) -> str:
        ss_url = " http://hunyuanapi.woa.com/openapi/v1/chat/completions"
        model = "hunyuan-standard-256K"
        # model = "hunyuan-lite"

        headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer j6V0zOI2dQ6KzVfCRiGSmtK3iJoZE876",
        }

        json_data = {
            "model": model,
            "query_id": "test_query_id_" + str(uuid.uuid4()),
            "messages": messages,
            "output_seq_len": 1024,
            "max_input_seq_len": 2048,
        }
        resp = requests.post(ss_url, headers=headers, json=json_data)
        return json.loads(resp.text)['choices'][0]['message']

class GPT(LLM):

    def __init__(self):
        super().__init__()
        print("construct gpt")

    def _call(self,
              prompt: ChatPromptTemplate
              ) -> str:
        messages = [
            {"role": "user", "content": prompt.messages[0].content}
        ]
        response = self.venus_completion(messages)
        # print(response)
        return response['content']

    def call(self,
             messages: List[dict],
             stop: Optional[List[str]] = None,
             callbacks: Optional[CallbackManagerForLLMRun] = None,
             **kwargs: Any,
             ) -> str:
        response = self.completion(messages)
        # print(response)
        return response

    def _llm_type(self) -> str:
        return "gpt"

    def completion(self, messages: List[dict]) -> str:
        # url = " https://openkey.cloud/v1/chat/completions"
        url = "http://v2.open.venus.oa.com/llmproxy/chat/completions"
        # model = "gpt-4o-mini"
        # model = "gpt-4o"
        # model = "gpt-4o-2024-08-06"
        # model = "claude-3-sonnet-20240229"
        model = "qwen3-235b-a22b-fp8-local-II"
        # model = "llama3.1-8b-instruct"
        # model = "gemini-1.5-pro"

        headers = {
            "Content-Type": "application/json",
            # "Authorization": "Bearer sk-YnwbXvcEV7ksvsKYqkEl3H3lYIsbraIgnNgnRr3Kg0yk2rgA",
            "Authorization": "Bearer n4MoOsTPlmquMT0sxxyrAfbp@3025",
        }

        data = {
            "model": model,
            "messages": messages,
            "tools": []
        }
        
        response = requests.post(url, headers=headers, json=data)
        print(response)
        # print("Status Code", response.status_code)
        # print("JSON Response ", response.json())
        
        return json.loads(response.text)['choices'][0]['message']

if __name__ == '__main__':
    llm = GPT()
    messages = [{"role": "user", "content": "Hello world!"}]
    
    # instruction = "Based on previous result, I want the formation to move slightly forward and significantly increase the pressing intensity."
    # human_prompt = prompt_natural_language_to_style_en.format(instruction=instruction)
    # messages = [{"role": "user", "content": human_prompt.content}]
    response = llm.call(messages)
    print(response['content'])
    