-- OPTIONAL TEST DATA ONLY. Not a school policy. Run explicitly after V3.
-- Existing codes are left untouched, including their administrator-edited steps.
SET NAMES utf8mb4;
START TRANSACTION;

SET @service_example_new = (SELECT COUNT(*) = 0 FROM service_item WHERE code='STUDENT_CARD_REISSUE');
INSERT INTO service_item (code,name,category,description,department,requirements,materials,recognition_rules,source_title,status,is_example)
SELECT 'STUDENT_CARD_REISSUE','学生证补办','学籍事务','测试数据 / 示例数据，仅演示办事引导，不代表任何学校真实政策；请以最新学校通知为准。','学生工作处（示例）','["测试条件：仅用于功能演示，真实办理资格待管理员核实。"]','[{"name":"学生证补办申请表（示例）","description":"示例材料，真实要求以学校文件为准。","required":true},{"name":"身份证明（示例）","description":"示例材料，真实要求以学校文件为准。","required":true},{"name":"证件照（示例）","description":"示例材料，真实要求以学校文件为准。","required":true}]','{"subjects":["学生证","学生卡"],"actions":["丢","遗失","补办","找不到","遗落"],"exclusions":["没丢","没有丢","校园卡"]}','测试数据 / 示例流程（非学校文件）','ACTIVE',TRUE WHERE @service_example_new;
SET @service_example_id = (SELECT id FROM service_item WHERE code='STUDENT_CARD_REISSUE');
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,1,'准备材料','示例步骤：具体办理方式和要求待学校真实文件确认。','学生工作处（示例）','["学生证补办申请表（示例）","身份证明（示例）","证件照（示例）"]' WHERE @service_example_new;
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,2,'填写申请','示例步骤：具体办理方式和要求待学校真实文件确认。','学生工作处（示例）','[]' WHERE @service_example_new;
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,3,'辅导员审核','示例步骤：具体办理方式和要求待学校真实文件确认。','学生工作处（示例）','[]' WHERE @service_example_new;
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,4,'学院审核','示例步骤：具体办理方式和要求待学校真实文件确认。','学生工作处（示例）','[]' WHERE @service_example_new;
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,5,'学生工作处办理','示例步骤：具体办理方式和要求待学校真实文件确认。','学生工作处（示例）','[]' WHERE @service_example_new;
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,6,'领取学生证','示例步骤：具体办理方式和要求待学校真实文件确认。','学生工作处（示例）','[]' WHERE @service_example_new;

SET @service_example_new = (SELECT COUNT(*) = 0 FROM service_item WHERE code='SCHOLARSHIP_APPLICATION');
INSERT INTO service_item (code,name,category,description,department,requirements,materials,recognition_rules,source_title,status,is_example)
SELECT 'SCHOLARSHIP_APPLICATION','奖学金申请','奖助事务','测试数据 / 示例数据，仅演示办事引导，不代表任何学校真实政策；请以最新学校通知为准。','奖助工作负责部门（示例）','["测试条件：仅用于功能演示，真实办理资格待管理员核实。"]','[{"name":"申请表（示例）","description":"示例材料，真实要求以学校文件为准。","required":true},{"name":"相关证明材料（示例）","description":"示例材料，真实要求以学校文件为准。","required":true}]','{"subjects":["奖学金"],"actions":["申请","申报","办理","怎么拿","如何拿"],"exclusions":["不申请"]}','测试数据 / 示例流程（非学校文件）','ACTIVE',TRUE WHERE @service_example_new;
SET @service_example_id = (SELECT id FROM service_item WHERE code='SCHOLARSHIP_APPLICATION');
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,1,'查看申请条件','示例步骤：具体办理方式和要求待学校真实文件确认。','奖助工作负责部门（示例）','["申请表（示例）","相关证明材料（示例）"]' WHERE @service_example_new;
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,2,'准备申请材料','示例步骤：具体办理方式和要求待学校真实文件确认。','奖助工作负责部门（示例）','[]' WHERE @service_example_new;
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,3,'提交申请','示例步骤：具体办理方式和要求待学校真实文件确认。','奖助工作负责部门（示例）','[]' WHERE @service_example_new;
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,4,'等待审核','示例步骤：具体办理方式和要求待学校真实文件确认。','奖助工作负责部门（示例）','[]' WHERE @service_example_new;
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,5,'查看结果','示例步骤：具体办理方式和要求待学校真实文件确认。','奖助工作负责部门（示例）','[]' WHERE @service_example_new;

SET @service_example_new = (SELECT COUNT(*) = 0 FROM service_item WHERE code='PSYCHOLOGICAL_ASSESSMENT');
INSERT INTO service_item (code,name,category,description,department,requirements,materials,recognition_rules,source_title,status,is_example)
SELECT 'PSYCHOLOGICAL_ASSESSMENT','心理测评','心理健康','测试数据 / 示例数据，仅演示办事引导，不代表任何学校真实政策；请以最新学校通知为准。','心理健康教育负责部门（示例）','["测试条件：仅用于功能演示，真实办理资格待管理员核实。"]','[]','{"subjects":["心理测评","心理测试"],"actions":["怎么做","如何做","参加","流程","怎么参加","如何参加"],"exclusions":["咨询中心","什么时候","几点","时间","对象","在哪里"]}','测试数据 / 示例流程（非学校文件）','ACTIVE',TRUE WHERE @service_example_new;
SET @service_example_id = (SELECT id FROM service_item WHERE code='PSYCHOLOGICAL_ASSESSMENT');
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,1,'查看测评通知','示例步骤：具体办理方式和要求待学校真实文件确认。','心理健康教育负责部门（示例）','[]' WHERE @service_example_new;
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,2,'确认测评入口','示例步骤：具体办理方式和要求待学校真实文件确认。','心理健康教育负责部门（示例）','[]' WHERE @service_example_new;
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,3,'完成测评','示例步骤：具体办理方式和要求待学校真实文件确认。','心理健康教育负责部门（示例）','[]' WHERE @service_example_new;
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,4,'查看后续说明','示例步骤：具体办理方式和要求待学校真实文件确认。','心理健康教育负责部门（示例）','[]' WHERE @service_example_new;

SET @service_example_new = (SELECT COUNT(*) = 0 FROM service_item WHERE code='STUDENT_LEAVE');
INSERT INTO service_item (code,name,category,description,department,requirements,materials,recognition_rules,source_title,status,is_example)
SELECT 'STUDENT_LEAVE','学生请假','学籍事务','测试数据 / 示例数据，仅演示办事引导，不代表任何学校真实政策；请以最新学校通知为准。','所在学院（示例）','["测试条件：仅用于功能演示，真实办理资格待管理员核实。"]','[{"name":"请假申请（示例）","description":"示例材料，真实要求以学校文件为准。","required":true},{"name":"情况说明（示例）","description":"示例材料，真实要求以学校文件为准。","required":true}]','{"subjects":["请假","病假","事假"],"actions":["请假","申请","办理","请","流程"],"exclusions":["不请假","不用请假"]}','测试数据 / 示例流程（非学校文件）','ACTIVE',TRUE WHERE @service_example_new;
SET @service_example_id = (SELECT id FROM service_item WHERE code='STUDENT_LEAVE');
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,1,'确认请假要求','示例步骤：具体办理方式和要求待学校真实文件确认。','所在学院（示例）','["请假申请（示例）","情况说明（示例）"]' WHERE @service_example_new;
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,2,'填写请假申请','示例步骤：具体办理方式和要求待学校真实文件确认。','所在学院（示例）','[]' WHERE @service_example_new;
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,3,'提交审核','示例步骤：具体办理方式和要求待学校真实文件确认。','所在学院（示例）','[]' WHERE @service_example_new;
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,4,'确认审核结果','示例步骤：具体办理方式和要求待学校真实文件确认。','所在学院（示例）','[]' WHERE @service_example_new;
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,5,'按要求销假','示例步骤：具体办理方式和要求待学校真实文件确认。','所在学院（示例）','[]' WHERE @service_example_new;

SET @service_example_new = (SELECT COUNT(*) = 0 FROM service_item WHERE code='DORM_REPAIR');
INSERT INTO service_item (code,name,category,description,department,requirements,materials,recognition_rules,source_title,status,is_example)
SELECT 'DORM_REPAIR','宿舍报修','宿舍事务','测试数据 / 示例数据，仅演示办事引导，不代表任何学校真实政策；请以最新学校通知为准。','后勤维修负责部门（示例）','["测试条件：仅用于功能演示，真实办理资格待管理员核实。"]','[{"name":"故障情况说明（示例）","description":"示例材料，真实要求以学校文件为准。","required":true}]','{"subjects":["宿舍","寝室"],"actions":["坏","报修","漏水","不亮","维修","不出水","堵"],"exclusions":["没坏","没有坏"]}','测试数据 / 示例流程（非学校文件）','ACTIVE',TRUE WHERE @service_example_new;
SET @service_example_id = (SELECT id FROM service_item WHERE code='DORM_REPAIR');
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,1,'记录故障情况','示例步骤：具体办理方式和要求待学校真实文件确认。','后勤维修负责部门（示例）','["故障情况说明（示例）"]' WHERE @service_example_new;
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,2,'提交报修','示例步骤：具体办理方式和要求待学校真实文件确认。','后勤维修负责部门（示例）','[]' WHERE @service_example_new;
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,3,'确认维修安排','示例步骤：具体办理方式和要求待学校真实文件确认。','后勤维修负责部门（示例）','[]' WHERE @service_example_new;
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,4,'配合维修','示例步骤：具体办理方式和要求待学校真实文件确认。','后勤维修负责部门（示例）','[]' WHERE @service_example_new;
INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials)
SELECT @service_example_id,5,'确认处理结果','示例步骤：具体办理方式和要求待学校真实文件确认。','后勤维修负责部门（示例）','[]' WHERE @service_example_new;

COMMIT;

