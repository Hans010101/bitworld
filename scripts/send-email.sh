#!/bin/bash
# BitWorld PDF 邮件发送脚本
# 用法: send-email.sh <收件人邮箱> <PDF文件路径> [报告标题]
source /Users/hans.pan/paperclip/scripts/.env-email
export TZ='Asia/Shanghai'

TO_EMAIL="$1"
PDF_FILE="$2"
SUBJECT="${3:-BitWorld 报告}"

if [ -z "$TO_EMAIL" ] || [ -z "$PDF_FILE" ]; then
  echo "用法: send-email.sh <邮箱> <PDF路径> [标题]"
  exit 1
fi

if [ ! -f "$PDF_FILE" ]; then
  echo "文件不存在: $PDF_FILE"
  exit 1
fi

export TO_EMAIL PDF_FILE SUBJECT
export DATE=$(date '+%Y-%m-%d %H:%M')

python3 - "$TO_EMAIL" "$PDF_FILE" "$SUBJECT" << 'PYEOF'
import smtplib, sys, os
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email.mime.text import MIMEText
from email import encoders

to_email = sys.argv[1]
pdf_file = sys.argv[2]
subject = sys.argv[3]

smtp_host = os.environ.get('SMTP_HOST', 'smtp.gmail.com')
smtp_port = int(os.environ.get('SMTP_PORT', '587'))
smtp_user = os.environ.get('SMTP_USER', '')
smtp_pass = os.environ.get('SMTP_PASS', '')

if not smtp_user or not smtp_pass:
    print("错误: 未配置 SMTP_USER 和 SMTP_PASS 环境变量")
    sys.exit(1)

msg = MIMEMultipart()
msg['From'] = smtp_user
msg['To'] = to_email
msg['Subject'] = f'[BitWorld] {subject}'

body = f'BitWorld 集团自动报告\n\n报告标题: {subject}\n发送时间: {os.environ.get("DATE", "")}\n\n此邮件由 BitWorld 自动发送，请查阅附件 PDF。'
msg.attach(MIMEText(body, 'plain', 'utf-8'))

with open(pdf_file, 'rb') as f:
    part = MIMEBase('application', 'pdf')
    part.set_payload(f.read())
    encoders.encode_base64(part)
    part.add_header('Content-Disposition', f'attachment; filename="{os.path.basename(pdf_file)}"')
    msg.attach(part)

try:
    if smtp_port == 465:
        import ssl
        context = ssl.create_default_context()
        server = smtplib.SMTP_SSL(smtp_host, smtp_port, context=context, timeout=15)
    else:
        server = smtplib.SMTP(smtp_host, smtp_port, timeout=15)
        server.starttls()
    server.login(smtp_user, smtp_pass)
    server.send_message(msg)
    server.quit()
    print(f"✅ 邮件已发送至 {to_email}")
except Exception as e:
    print(f"❌ 邮件发送失败: {e}")
    sys.exit(1)
PYEOF
