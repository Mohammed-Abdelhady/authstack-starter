# Session device names

`GET /api/user/sessions` keeps the stored `deviceName` unchanged and adds optional
`deviceParts` derived from the stored `userAgent`. No migration is required.
`kind` is `browser`, `mobileApp`, or `unknown`. Optional `browserName`,
`browserMajorVersion`, `platformName`, and `platformVersion` are language-neutral
strings. CFNetwork/Darwin identifies iOS and okhttp identifies Android. Their
library and kernel versions do not imply an OS version. Parsing examines at most
512 characters. Native credentials identify a mobile app even when its agent
names a browser. Clients translate connecting words through their catalogues and
isolate proper names and versions as LTR runs. Older servers omit `deviceParts`,
and clients keep displaying the stored phrase.
