#!/bin/bash
echo "========================================="
echo "  GitHubへのコード同期（Push）を開始します"
echo "========================================="
echo ""

git add .

read -p "コミットメッセージを入力してください (そのままEnterで 'Update' になります): " msg
if [ -z "$msg" ]; then
    msg="Update"
fi

echo ""
git commit -m "$msg"
echo ""

echo "GitHubへ送信しています..."
git push

echo ""
echo "========================================="
echo "  処理が完了しました。"
echo "========================================="
