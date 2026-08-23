step 1
in terminal cd stark-ai-be
 .\venv\Scripts\Activate.ps1
then uvicorn server:app --host 0.0.0.0 --port 8000 --reload

step 2
python main.py

step 3
cd satark-ai-fe
then  $env:REACT_NATIVE_PACKAGER_HOSTNAME="{10.134.10.89}";
npx expo start

{Your own ipv4 id}