-- Fab Yield Miner 数据库初始化脚本
-- 需要 PostgreSQL + PostGIS 扩展

-- 创建数据库（请手动执行）
-- CREATE DATABASE fab_yield;

-- 启用 PostGIS 扩展
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- 验证安装
SELECT PostGIS_Version();
