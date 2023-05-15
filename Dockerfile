FROM python:3.9

WORKDIR /app

RUN pip install openai

RUN touch /app/file.txt