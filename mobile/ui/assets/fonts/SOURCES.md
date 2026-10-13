# Native UI fonts

The static TTF files are derived from the exact variable WOFF2 files bundled by the web app. Each file pins `wght` to its filename's value and keeps its original glyph map. The derivative family is App UI Sans. Each weight has its own PostScript name and weight class.
Noto Sans Arabic also pins `wdth` to its default value of 100. Its derivative family is App UI Arabic. <!-- feature:locale-ar -->

| Source                                        | SHA-256                                                            | License                  |
| --------------------------------------------- | ------------------------------------------------------------------ | ------------------------ |
| `frontend/src/app/fonts/Geist.woff2`          | `99234af229f805e613fcd5677af9bc556a8c274b55f21e341cd772189329aa3d` | `OFL-Geist.txt`          |
| `frontend/src/app/fonts/NotoSansArabic.woff2` | `05ff29bb66f9fb615a2d75ee090e0fb204ca655c468c9faed991b3699352b9dd` | `OFL-NotoSansArabic.txt` | <!-- feature:locale-ar --> |

| Native file           | Weight | SHA-256                                                            |
| --------------------- | -----: | ------------------------------------------------------------------ |
| `AppUISans-400.ttf`   |    400 | `ef8b21060d963f5b709fd39e1605c84f260062e92282159a4a083e494462b417` |
| `AppUISans-500.ttf`   |    500 | `64891055c6faef5c773da6e79db083d967cbcb3648fc75fc73dc081663e6ba81` |
| `AppUISans-600.ttf`   |    600 | `b1beeced3098e121f86f91bcd6f3c082d908b19b57b377b2245a68e30f0b7fc5` |
| `AppUISans-800.ttf`   |    800 | `59e0ddb90ded99afc2c80287fec6ed9b8f652c006b375e8ede887483d55e53be` |
| `AppUIArabic-400.ttf` |    400 | `df161004348217954bf24aaec5a3d327a0cb483402d6062802186ef5d21bf94f` | <!-- feature:locale-ar --> |
| `AppUIArabic-500.ttf` |    500 | `be62b78bd0921a0792c249be9f4919f2d0ae3f8f761b6f3561523d55c28514d2` | <!-- feature:locale-ar --> |
| `AppUIArabic-600.ttf` |    600 | `dfb0e2626901c2c15cea072440603ee61661b086b40ee5ceb2a0ac5b1c9c06d6` | <!-- feature:locale-ar --> |
| `AppUIArabic-800.ttf` |    800 | `7fcad9bc61dba64e8d7ebfb969b1a005d789e6e920a66a33ead380deb857eed4` | <!-- feature:locale-ar --> |

The source font uses the SIL Open Font License 1.1. Its license text is copied here from the web font directory. The source WOFF2 file has no declared Reserved Font Name, but the modified files use separate family and PostScript names to avoid presenting them as the original font.
The Arabic source and derivatives use the same license and naming approach. <!-- feature:locale-ar -->
