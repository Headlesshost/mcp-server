systemctl enable mcp.service
systemctl start mcp.service
systemctl daemon-reload
systemctl start httpd
echo 0