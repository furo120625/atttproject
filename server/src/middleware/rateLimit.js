// One-process limiter, no dependency changes. Bounded map; expires idle buckets.
// Multiple server instances need a shared limiter before production scaling.
function rateLimit({limit, windowMs, key = req => req.session?.userId || req.ip}) {
    const entries = new Map();
    const timer = setInterval(() => {
        const now = Date.now();
        for (const [id, value] of entries) if (value.until <= now) entries.delete(id);
    }, Math.min(windowMs, 60000));
    timer.unref();
    return (req, res, next) => {
        const id = key(req), now = Date.now();
        let bucket = entries.get(id);
        if (!bucket || bucket.until <= now) {
            if (!bucket && entries.size >= 10000) return res.status(429).json({message: 'Too many active requests; please retry later'});
            bucket = {until: now + windowMs, count: 0}; entries.set(id, bucket);
        }
        if (++bucket.count > limit) {
            res.set('Retry-After', String(Math.ceil((bucket.until - now) / 1000)));
            return res.status(429).json({message: 'Too many requests; please try again later'});
        }
        next();
    };
}
module.exports = rateLimit;
