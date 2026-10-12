# 启动数据库 SSH 隧道：本地 3306 -> 47.115.220.98 的 MySQL
# 阿里云安全组未放行 3306 时使用本隧道；放行后可改用 DB_HOST=47.115.220.98 直连
plink -batch -ssh -hostkey "SHA256:G/dgUym87lN7Ik/EADOiXGSZNSug72UbSNMst0pdFbQ" -pw "MdHJCDMyYDtK4P" -L 3306:127.0.0.1:3306 -N root@47.115.220.98
