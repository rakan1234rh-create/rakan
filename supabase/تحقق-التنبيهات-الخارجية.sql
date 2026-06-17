-- تحقق سريع من إعداد التنبيهات الخارجية
-- شغّل في SQL Editor بعد تسجيل الدخول كمستخدم أو كـ postgres

-- 1) هل الجدول موجود؟
select count(*) as subscription_count from public.push_subscriptions;

-- 2) اشتراكات كل مستخدم (بدون تفاصيل حساسة)
select u.name, u.role, count(ps.id) as devices
from public.users u
left join public.push_subscriptions ps on ps.user_id = u.id
where u.is_active = true
group by u.id, u.name, u.role
order by devices desc, u.name;

-- 3) هل current_user_id يعمل لجلستك؟
select public.current_user_id() as my_user_id;
